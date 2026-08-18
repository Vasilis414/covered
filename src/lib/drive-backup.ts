import { File, Paths } from 'expo-file-system';

import { displayName, mimeTypeFor } from '@/lib/attachments';
import type { StorageItem } from '@/store/storage';
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

type BackedUpStorageItem = Omit<StorageItem, 'photoUris'> & {
  attachments?: { id: string; name: string }[];
};

export type BackupManifest = {
  version: 3;
  updatedAt: string;
  items: BackedUpItem[];
  storageItems: BackedUpStorageItem[];
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
 * Uploads a file via simple/multipart upload.
 *
 * For metadata only (or files under MULTIPART_LIMIT), this does the upload in
 * one HTTP request. It builds a standard multipart/related body holding the
 * metadata JSON block first and the file bytes second.
 */
async function uploadMultipart(
  token: string,
  name: string,
  mimeType: string,
  payload: string,
  existingId?: string | null,
  isBase64 = true,
): Promise<string> {
  const metadata = { name, parents: existingId ? undefined : ['appDataFolder'] };
  const boundary = 'covered_multipart_boundary';

  /**
   * Content-Transfer-Encoding is sent only for payloads that really are base64.
   * It used to be unconditional, which meant the manifest — plain JSON — was
   * announced as base64 too. Drive tried to decode it, failed, and answered
   * 400 on the last step of every single backup.
   */
  const encodingHeader = isBase64 ? 'Content-Transfer-Encoding: base64\r\n' : '';

  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n${encodingHeader}\r\n${payload}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `${DRIVE_UPLOAD}/${existingId}?uploadType=multipart`
    : `${DRIVE_UPLOAD}?uploadType=multipart`;

  const response = await driveFetch(token, url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });

  if (!response.ok) throw await driveError(response, 'Drive upload failed');
  const bodyJson = (await response.json()) as { id: string };
  return bodyJson.id;
}

/**
 * Uploads a file in chunks using a resumable session.
 *
 * Opens a session first by POSTing the metadata, which hands back a session
 * URL. We then upload the base64 content in one final PUT to that URL. Crucial
 * for PDF manuals that are larger than Google's multipart limit.
 */
async function uploadResumable(
  token: string,
  name: string,
  mimeType: string,
  payload: string,
  existingId?: string | null,
  isBase64 = true,
): Promise<string> {
  const metadata = { name, parents: existingId ? undefined : ['appDataFolder'] };
  const sessionUrl = existingId
    ? `${DRIVE_UPLOAD}/${existingId}?uploadType=resumable`
    : `${DRIVE_UPLOAD}?uploadType=resumable`;

  const initResponse = await driveFetch(token, sessionUrl, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(metadata),
  });

  if (!initResponse.ok) throw await driveError(initResponse, 'Resumable start failed');
  const uploadUrl = initResponse.headers.get('Location');
  if (!uploadUrl) throw new Error('Drive gave no upload location');

  // Perform the actual content upload
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      ...(isBase64 ? { 'Content-Transfer-Encoding': 'base64' } : {}),
    },
    body: payload,
  });

  if (!response.ok) throw await driveError(response, 'Resumable chunk failed');
  const bodyJson = (await response.json()) as { id: string };
  return bodyJson.id;
}

async function uploadFile(
  token: string,
  name: string,
  mimeType: string,
  payload: string,
  existingId?: string | null,
  isBase64 = true,
): Promise<string> {
  return payload.length > MULTIPART_LIMIT
    ? uploadResumable(token, name, mimeType, payload, existingId, isBase64)
    : uploadMultipart(token, name, mimeType, payload, existingId, isBase64);
}

async function downloadText(token: string, fileId: string): Promise<string> {
  const response = await driveFetch(token, `${DRIVE_FILES}/${fileId}?alt=media`);
  if (!response.ok) throw await driveError(response, 'Drive download failed');
  return response.text();
}

async function downloadBytes(token: string, fileId: string): Promise<Uint8Array> {
  const response = await driveFetch(token, `${DRIVE_FILES}/${fileId}?alt=media`);
  if (!response.ok) throw await driveError(response, 'Drive download failed');
  return new Uint8Array(await response.arrayBuffer());
}

function photoBackupName(uri: string): string {
  return `photo-${uri.split('/').pop() ?? Math.random().toString(36).slice(2)}`;
}

export async function backupToDrive(
  token: string,
  items: WarrantyItem[],
  storageItems: StorageItem[],
  knownPhotos: Record<string, string> = {},
): Promise<{ result: BackupResult; photoMap: Record<string, string> }> {
  const photoMap: Record<string, string> = { ...knownPhotos };
  const failed: string[] = [];
  let uploaded = 0;

  const processItemsList = async <T extends { photoUris: string[]; name: string }, R>(
    list: T[],
    wrap: (item: T, attachments: { id: string; name: string }[]) => R
  ): Promise<R[]> => {
    const backedUpList: R[] = [];
    for (const item of list) {
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
          failed.push(displayName(uri));
        }
      }
      backedUpList.push(wrap(item, attachments));
    }
    return backedUpList;
  };

  const backedUpItems = await processItemsList<WarrantyItem, BackedUpItem>(items, (item, attachments) => {
    const { photoUris, ...rest } = item;
    return { ...rest, attachments };
  });

  const backedUpStorageItems = await processItemsList<StorageItem, BackedUpStorageItem>(storageItems, (item, attachments) => {
    const { photoUris, ...rest } = item;
    return { ...rest, attachments };
  });

  const manifest: BackupManifest = {
    version: 3,
    updatedAt: new Date().toISOString(),
    items: backedUpItems,
    storageItems: backedUpStorageItems,
  };

  const existing = await findManifestId(token);
  await uploadFile(token, MANIFEST_NAME, 'application/json', JSON.stringify(manifest), existing, false);

  return {
    result: {
      itemCount: items.length + storageItems.length,
      photoCount: uploaded,
      updatedAt: manifest.updatedAt,
      failed,
    },
    photoMap,
  };
}

/** Pulls the backup down, writing photos back to local storage. */
export async function restoreFromDrive(
  token: string
): Promise<{ items: WarrantyItem[]; storageItems: StorageItem[] } | null> {
  const manifestId = await findManifestId(token);
  if (!manifestId) return null;

  const manifest = JSON.parse(await downloadText(token, manifestId)) as {
    version?: number;
    items?: BackedUpItem[];
    storageItems?: BackedUpStorageItem[];
  };

  if (!Array.isArray(manifest.items)) return null;

  /** From version 3, Drive holds decoded bytes rather than base64 text. */
  const storesRawBytes = (manifest.version ?? 1) >= 3;

  const restoredItems: WarrantyItem[] = [];
  const restoredStorageItems: StorageItem[] = [];

  const restoreList = async <T extends { attachments?: { id: string; name: string }[]; photoFileIds?: string[] }, R>(
    backedUpList: T[],
    onRestored: (item: T, photoUris: string[]) => R
  ) => {
    const resultList: R[] = [];
    for (const item of backedUpList) {
      const { photoFileIds, attachments } = item;
      const photoUris: string[] = [];

      const entries =
        attachments ?? (photoFileIds ?? []).map((id) => ({ id, name: `${id}.jpg` }));

      for (const entry of entries) {
        try {
          const extension = entry.name.split('.').pop()?.toLowerCase() ?? 'jpg';
          const target = new File(Paths.document, 'photos', `${entry.id}.${extension}`);
          await target.parentDirectory.create({ intermediates: true, idempotent: true });

          /**
           * Version 3 onwards stores real bytes, because uploads now declare
           * Content-Transfer-Encoding and Drive decodes them. Earlier backups
           * hold base64 as text, so they still have to be decoded on the way
           * back in — reading one the wrong way produces a corrupt file rather
           * than an error, so the manifest version decides.
           */
          if (storesRawBytes) {
            await target.write(await downloadBytes(token, entry.id));
          } else {
            await target.write(await downloadText(token, entry.id), { encoding: 'base64' });
          }
          photoUris.push(target.uri);
        } catch {
          // Skip a file that won't come back rather than losing the item.
        }
      }
      resultList.push(onRestored(item, photoUris));
    }
    return resultList;
  };

  const finalItems = await restoreList<BackedUpItem, WarrantyItem>(manifest.items, (item, photoUris) => {
    const { photoFileIds, attachments, ...rest } = item;
    return { ...rest, photoUris } as WarrantyItem;
  });
  restoredItems.push(...finalItems);

  if ((manifest.version ?? 1) >= 2 && Array.isArray(manifest.storageItems)) {
    const finalStorage = await restoreList<BackedUpStorageItem, StorageItem>(manifest.storageItems, (item, photoUris) => {
      const { attachments, ...rest } = item;
      return { ...rest, photoUris } as StorageItem;
    });
    restoredStorageItems.push(...finalStorage);
  }

  return {
    items: restoredItems,
    storageItems: restoredStorageItems,
  };
}
