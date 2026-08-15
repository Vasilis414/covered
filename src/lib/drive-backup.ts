import { File, Paths } from 'expo-file-system';

import { displayName, mimeTypeFor } from '@/lib/attachments';
import type { WarrantyItem } from '@/types/item';

/**
 * Backs the library up to the user's own Google Drive.
 *
 * Everything goes in `appDataFolder` — a hidden per-app folder in the user's
 * Drive. It doesn't appear in their file list, it's scoped to this app alone,
 * and it costs us nothing because it counts against their storage, not ours.
 *
 * Receipt photos are backed up too, since a warranty record without its proof
 * is not worth restoring. Each photo is uploaded once and referenced by its
 * Drive file id, so repeat backups only send what's new.
 */

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const MANIFEST_NAME = 'covered-backup.json';

/** Item as stored in the backup: local paths are swapped for Drive file ids. */
type BackedUpItem = Omit<WarrantyItem, 'photoUris'> & {
  /** Legacy shape — ids only, assumed to be JPEGs. */
  photoFileIds?: string[];
  /** Current shape, which keeps the filename so PDFs restore as PDFs. */
  attachments?: { id: string; name: string }[];
};

export type BackupManifest = {
  version: 1;
  updatedAt: string;
  items: BackedUpItem[];
};

export type BackupResult = {
  itemCount: number;
  photoCount: number;
  updatedAt: string;
  /** Attachments that could not be uploaded, by display name. Never silent. */
  failed: string[];
};

/**
 * Drive's multipart endpoint refuses anything over 5 MB, and the body sent here
 * is base64, which is a third larger than the file it encodes. Photos are a few
 * hundred KB and never came close; a PDF invoice routinely does. Past this size
 * the upload switches to a resumable session, which has no practical ceiling.
 */
const MULTIPART_LIMIT = 4 * 1024 * 1024;

/**
 * A refusal point, so a pathological file fails with a message rather than
 * taking the app down trying to hold it in memory twice over.
 */
const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024;


/**
 * Drive's 403 covers two very different problems — the API being switched off
 * for the project, and the token lacking the scope — so surface its own
 * message rather than just the status.
 */
async function driveError(response: Response, step: string): Promise<Error> {
  let detail = '';
  try {
    const body = (await response.json()) as {
      error?: { message?: string; status?: string; errors?: { reason?: string }[] };
    };
    const reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
    detail = [reason, body.error?.message].filter(Boolean).join(': ');
  } catch {
    detail = await response.text().catch(() => '');
  }
  return new Error(`${step} ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
}

async function driveFetch(token: string, url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

/** The manifest's Drive id, or null the first time we back up. */
async function findManifestId(token: string): Promise<string | null> {
  const query = encodeURIComponent(`name='${MANIFEST_NAME}' and trashed=false`);
  const response = await driveFetch(
    token,
    `${DRIVE_FILES}?spaces=appDataFolder&q=${query}&fields=files(id)`,
  );
  if (!response.ok) throw await driveError(response, 'Drive list failed');
  const body = (await response.json()) as { files?: { id: string }[] };
  return body.files?.[0]?.id ?? null;
}

/**
 * Multipart upload: metadata part, then the bytes. Drive has no simpler way to
 * create a file and set its parent in one request. Capped at 5 MB by Drive,
 * so `uploadFile` sends anything larger the resumable way instead.
 */
async function uploadMultipart(
  token: string,
  name: string,
  mimeType: string,
  body: string,
  existingId?: string | null,
): Promise<string> {
  const boundary = `covered${Math.random().toString(36).slice(2)}`;
  const metadata = existingId
    ? { name }
    : { name, parents: ['appDataFolder'] };

  const payload =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n` +
    `${body}\r\n--${boundary}--`;

  const url = existingId
    ? `${DRIVE_UPLOAD}/${existingId}?uploadType=multipart`
    : `${DRIVE_UPLOAD}?uploadType=multipart`;

  const response = await driveFetch(token, url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: payload,
  });

  if (!response.ok) throw await driveError(response, 'Drive upload failed');
  const created = (await response.json()) as { id: string };
  return created.id;
}

/**
 * Two-step upload for large files: open a session, then send the content to the
 * URL Drive hands back. Costs an extra round trip, which is why small files
 * still go the multipart way, but it has no size ceiling worth worrying about.
 */
async function uploadResumable(
  token: string,
  name: string,
  mimeType: string,
  body: string,
  existingId?: string | null,
): Promise<string> {
  const metadata = existingId ? { name } : { name, parents: ['appDataFolder'] };
  const startUrl = existingId
    ? `${DRIVE_UPLOAD}/${existingId}?uploadType=resumable`
    : `${DRIVE_UPLOAD}?uploadType=resumable`;

  const start = await driveFetch(token, startUrl, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(metadata),
  });
  if (!start.ok) throw await driveError(start, 'Drive upload session failed');

  const session = start.headers.get('location');
  if (!session) throw new Error('Drive upload session failed — no session URL');

  // The session URL carries its own credentials, so it is fetched directly.
  const upload = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body,
  });
  if (!upload.ok) throw await driveError(upload, 'Drive upload failed');

  const created = (await upload.json()) as { id: string };
  return created.id;
}

async function uploadFile(
  token: string,
  name: string,
  mimeType: string,
  body: string,
  existingId?: string | null,
): Promise<string> {
  return body.length > MULTIPART_LIMIT
    ? uploadResumable(token, name, mimeType, body, existingId)
    : uploadMultipart(token, name, mimeType, body, existingId);
}

async function downloadText(token: string, fileId: string): Promise<string> {
  const response = await driveFetch(token, `${DRIVE_FILES}/${fileId}?alt=media`);
  if (!response.ok) throw await driveError(response, 'Drive download failed');
  return response.text();
}

function photoBackupName(uri: string): string {
  return `photo-${uri.split('/').pop() ?? Math.random().toString(36).slice(2)}`;
}

export async function backupToDrive(
  token: string,
  items: WarrantyItem[],
  /** Photo uri -> Drive id from the last run, so unchanged photos aren't re-sent. */
  knownPhotos: Record<string, string> = {},
): Promise<{ result: BackupResult; photoMap: Record<string, string> }> {
  const photoMap: Record<string, string> = { ...knownPhotos };
  const failed: string[] = [];
  let uploaded = 0;

  const backedUp: BackedUpItem[] = [];
  for (const item of items) {
    const attachments: { id: string; name: string }[] = [];

    for (const uri of item.photoUris) {
      const name = photoBackupName(uri);
      if (photoMap[uri]) {
        attachments.push({ id: photoMap[uri], name });
        continue;
      }
      try {
        const base64 = await new File(uri).base64();
        if (base64.length > MAX_ATTACHMENT_BYTES) {
          throw new Error('file is too large to back up');
        }
        const id = await uploadFile(token, name, mimeTypeFor(uri), base64);
        photoMap[uri] = id;
        attachments.push({ id, name });
        uploaded += 1;
      } catch {
        /**
         * One unreadable file shouldn't cost the rest of the backup — but it
         * must not pass unnoticed either. Swallowing this silently is how a PDF
         * went missing while the app reported a clean backup.
         */
        failed.push(displayName(uri));
      }
    }

    const { photoUris, ...rest } = item;
    backedUp.push({ ...rest, attachments });
  }

  const manifest: BackupManifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: backedUp,
  };

  const existing = await findManifestId(token);
  await uploadFile(token, MANIFEST_NAME, 'application/json', JSON.stringify(manifest), existing);

  return {
    result: {
      itemCount: items.length,
      photoCount: uploaded,
      updatedAt: manifest.updatedAt,
      failed,
    },
    photoMap,
  };
}

/** Pulls the backup down, writing photos back to local storage. */
export async function restoreFromDrive(token: string): Promise<WarrantyItem[] | null> {
  const manifestId = await findManifestId(token);
  if (!manifestId) return null;

  const manifest = JSON.parse(await downloadText(token, manifestId)) as BackupManifest;
  if (!Array.isArray(manifest.items)) return null;

  const restored: WarrantyItem[] = [];

  for (const item of manifest.items) {
    const { photoFileIds, attachments, ...rest } = item;
    const photoUris: string[] = [];

    // Older backups stored bare ids and were always JPEGs.
    const entries =
      attachments ?? (photoFileIds ?? []).map((id) => ({ id, name: `${id}.jpg` }));

    for (const entry of entries) {
      try {
        const base64 = await downloadText(token, entry.id);
        const extension = entry.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const target = new File(Paths.document, 'photos', `${entry.id}.${extension}`);
        target.parentDirectory.create({ intermediates: true, idempotent: true });
        target.write(base64, { encoding: 'base64' });
        photoUris.push(target.uri);
      } catch {
        // Skip a file that won't come back rather than losing the item.
      }
    }

    restored.push({ ...rest, photoUris } as WarrantyItem);
  }

  return restored;
}
