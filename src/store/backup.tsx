import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Alert, AppState, Platform } from 'react-native';

import { API_BASE } from '@/lib/api';
import { mimeTypeFor } from '@/lib/attachments';
import { resolvePhotoUri } from '@/lib/photos';
import { backupToDrive, restoreFromDrive } from '@/lib/drive-backup';
import { useAuth } from '@/store/auth';
import { useItems } from '@/store/items';
import { useSettings } from '@/store/settings';
import { useStorage, type StorageItem } from '@/store/storage';
import type { WarrantyItem } from '@/types/item';

const STATE_KEY = 'covered.backup.state.v1';
/** Wait for edits to settle rather than uploading on every keystroke-driven save. */
const DEBOUNCE_MS = 8_000;

type PersistedState = {
  lastBackupAt?: string;
  /** Local photo uri -> Drive file id or server url, so unchanged photos aren't re-uploaded. */
  photoMap?: Record<string, string>;
};

type BackupContextValue = {
  lastBackupAt: string | null;
  status: 'idle' | 'running' | 'error';
  message: string | null;
  backupNow: () => Promise<void>;
  restoreNow: () => Promise<number | null>;
};

const BackupContext = createContext<BackupContextValue | null>(null);

async function uploadFileToServer(token: string, localUri: string): Promise<string> {
  const name = localUri.split('/').pop() || 'upload';
  const mimeType = mimeTypeFor(localUri);

  const fileInfo = await FileSystem.getInfoAsync(localUri);
  if (!fileInfo.exists) {
    throw new Error('file not found on device');
  }

  const response = await FileSystem.uploadAsync(`${API_BASE}/storage/upload`, localUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mimeType,
      'X-File-Name': encodeURIComponent(name),
    },
  });

  if (response.status !== 200) {
    let err = `status ${response.status}`;
    try {
      const parsed = JSON.parse(response.body);
      err = parsed.error || err;
    } catch {}
    throw new Error(err);
  }

  const result = JSON.parse(response.body) as { url: string };
  return result.url;
}

export function BackupProvider({ children }: { children: ReactNode }) {
  const { items, ready: itemsReady, mergeItems } = useItems();
  const { storageItems, ready: storageReady, mergeStorageItems } = useStorage();
  const { entitlement, getAccessToken, getIdToken, signedIn, authProvider, refresh, signIn, signInWithPlenum } =
    useAuth();
  const { googleBackupDestination, setGoogleBackupDestination } = useSettings();

  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const photoMap = useRef<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  /** Snapshot of what was last uploaded, so we skip no-op backups. */
  const lastPayload = useRef<string | null>(null);

  const ready = itemsReady && storageReady;
  const premium = Boolean(entitlement?.paid);
  const useCloud = authProvider === 'plenum' || (authProvider === 'google' && googleBackupDestination === 'cloud');

  useEffect(() => {
    AsyncStorage.getItem(STATE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as PersistedState;
        photoMap.current = parsed.photoMap ?? {};
        setLastBackupAt(parsed.lastBackupAt ?? null);
      })
      .catch(() => {});
  }, []);

  const persist = useCallback(async (updatedAt: string) => {
    setLastBackupAt(updatedAt);
    await AsyncStorage.setItem(
      STATE_KEY,
      JSON.stringify({ lastBackupAt: updatedAt, photoMap: photoMap.current }),
    );
  }, []);

  const run = useCallback(
    async (reason: 'auto' | 'manual') => {
      if (running.current || !premium) return;

      const payload = JSON.stringify({ items, storageItems });
      // Nothing changed since the last upload, so don't spend the round trip.
      if (reason === 'auto' && payload === lastPayload.current) return;

      /**
       * No Drive permission is not a dead end — it is a different destination.
       *
       * Signing in without granting the Drive scope leaves getAccessToken with
       * nothing to return, and the backup simply failed with an error telling
       * people to sign in again. Falling back to Covered's own storage keeps
       * their data safe by default; re-granting Drive needs a fresh consent
       * screen, which only a full sign-out and sign-in will show.
       */
      let token = useCloud ? getIdToken() : await getAccessToken();
      if (!useCloud && !token) {
        setGoogleBackupDestination('cloud');
        token = getIdToken();
        if (reason === 'manual') {
          setMessage(
            "Backing up to Covered's storage — this app doesn't have permission for your Google Drive. To use Drive instead, sign out and sign in again, allowing Drive access.",
          );
        }
      }

      if (!token) {
        if (reason === 'manual') {
          setStatus('error');
          setMessage('Could not reach your backup. Open Settings and sign in again.');
        }
        return;
      }

      running.current = true;
      setStatus('running');
      try {
        if (useCloud) {
          const failed: string[] = [];
          let uploaded = 0;
          /** Attachments whose file is gone — counted so this is never silent. */
          let missing = 0;
          const updatedPhotoMap = { ...photoMap.current };

          const processItems = async <T extends { photoUris: string[]; name: string }>(list: T[]): Promise<T[]> => {
            const result: T[] = [];
            for (const item of list) {
              const photoUris: string[] = [];
              for (const uri of item.photoUris) {
                if (uri.startsWith('http://') || uri.startsWith('https://')) {
                  photoUris.push(uri);
                  continue;
                }
                if (updatedPhotoMap[uri]) {
                  photoUris.push(updatedPhotoMap[uri]);
                  continue;
                }

                /**
                 * A local path that is not on disk is dropped, not re-saved.
                 *
                 * Keeping it created a loop nothing could recover from: iOS
                 * gives the app a new container id on every reinstall, so the
                 * old path is permanently dead; restore put that dead path
                 * into state, the next backup found no file and skipped the
                 * upload, and wrote the dead path back to the server. The
                 * bytes were never uploaded and never could be.
                 */
                // Rebase first: a path from a previous install points at a
                // container that no longer exists, but the file is still there.
                const localUri = resolvePhotoUri(uri);
                try {
                  const fileInfo = await FileSystem.getInfoAsync(localUri);
                  if (!fileInfo.exists) {
                    missing += 1;
                    continue;
                  }
                } catch {
                  missing += 1;
                  continue;
                }

                try {
                  const serverUrl = await uploadFileToServer(token, localUri);
                  updatedPhotoMap[uri] = serverUrl;
                  photoUris.push(serverUrl);
                  uploaded += 1;
                } catch (err: any) {
                  failed.push(`${item.name || 'item'} (${err?.message || 'error'})`);
                  photoUris.push(uri);
                }
              }
              result.push({ ...item, photoUris });
            }
            return result;
          };

          const processedItems = await processItems(items);
          const processedStorageItems = await processItems(storageItems);

          photoMap.current = updatedPhotoMap;

          const backupResponse = await fetch(`${API_BASE}/backup`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              items: {
                items: processedItems,
                storageItems: processedStorageItems
              },
              device: Platform.OS
            })
          });

          if (!backupResponse.ok) {
            const errorBody = await backupResponse.json().catch(() => ({}));
            throw new Error((errorBody as { error?: string }).error || `Backup failed with status ${backupResponse.status}`);
          }

          const backupResult = await backupResponse.json() as { itemCount: number };
          lastPayload.current = payload;
          const nowStr = new Date().toISOString();
          await persist(nowStr);
          await refresh().catch(() => {});

          const summary =
            `Backed up ${backupResult.itemCount} item${backupResult.itemCount === 1 ? '' : 's'}` +
            (uploaded ? ` and ${uploaded} new file${uploaded === 1 ? '' : 's'}` : '');

          const isDev = entitlement?.email === 'vas93333@gmail.com' || entitlement?.email === 'vasilis@plenum.gr';
          if (missing > 0) {
            // Dropped rather than uploaded — say so, because the item silently
            // losing its receipt is exactly what a backup is meant to prevent.
            setStatus('error');
            setMessage(
              `${summary}. ${missing} attachment${missing === 1 ? '' : 's'} could not be found on this device and ${missing === 1 ? 'was' : 'were'} removed from the backup.`,
            );
          } else if (failed.length > 0) {
            setStatus('error');
            const details = isDev ? `: ${failed.join(', ')}` : '.';
            setMessage(`${summary}, but ${failed.length} file${failed.length === 1 ? '' : 's'} could not be saved${details}`);
          } else {
            setStatus('idle');
            setMessage(summary);
          }
        } else {
          // Google Drive flow
          const { result, photoMap: updated } = await backupToDrive(token, items, storageItems, photoMap.current);
          photoMap.current = updated;
          lastPayload.current = payload;
          await persist(result.updatedAt);

          const summary =
            `Backed up ${result.itemCount} item${result.itemCount === 1 ? '' : 's'}` +
            (result.photoCount
              ? ` and ${result.photoCount} new file${result.photoCount === 1 ? '' : 's'}`
              : '');

          if (result.failed.length > 0) {
            setStatus('error');
            setMessage(
              `${summary}, but ${result.failed.length} file${result.failed.length === 1 ? '' : 's'} could not be saved: ${result.failed.join(', ')}`,
            );
          } else {
            setStatus('idle');
            setMessage(summary);
          }
        }
      } catch (error) {
        setStatus('error');
        const errStr = String(error);
        if (errStr.includes('unauthorized') || errStr.includes('401')) {
          promptReauth();
        } else {
          setMessage(errStr);
        }
      } finally {
        running.current = false;
      }
    },
    [premium, items, storageItems, useCloud, getIdToken, getAccessToken, persist, refresh, entitlement?.email, setGoogleBackupDestination],
  );

  // Auto-backup: debounce so a burst of edits produces one upload.
  useEffect(() => {
    if (!ready || !premium) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run('auto'), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [items, storageItems, ready, premium, run]);

  // Also catch the app going to the background, which is when edits usually stop.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') void run('auto');
    });
    return () => subscription.remove();
  }, [run]);

  /**
   * Recovers an expired session without making the user sign out first.
   *
   * Plenum's OAuth server issues no refresh token and rejects the
   * refresh_token grant, so the access token cannot be renewed silently — the
   * authorisation flow has to run again. It is usually a single tap, because
   * the browser still holds the plenum.gr session cookie.
   */
  const promptReauth = useCallback(() => {
    setMessage('Your session expired. Sign in again to keep backing up.');
    Alert.alert(
      'Session expired',
      'Your sign-in with Plenum has timed out. Sign in again to resume backups — you should not need to re-enter anything.',
      [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Sign in again',
          onPress: () => {
            void (authProvider === 'plenum' ? signInWithPlenum() : signIn());
          },
        },
      ],
    );
  }, [authProvider, signInWithPlenum, signIn]);

  const downloadPhotos = useCallback(async <T extends { photoUris: string[]; id: string }>(list: T[], token: string): Promise<T[]> => {
    const result: T[] = [];
    const dir = `${FileSystem.documentDirectory}photos/`;
    try {
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }
    } catch {}

    for (const item of list) {
      const photoUris: string[] = [];
      for (const uri of item.photoUris) {
        /**
         * A local path is only meaningful on the device that wrote it. The
         * container is not the same one after a reinstall, and it was never the
         * same on a second phone — so a file:// entry that is not actually
         * there is dropped rather than kept as a tile that can never load.
         */
        if (uri.startsWith('file://')) {
          const localUri = resolvePhotoUri(uri);
          try {
            const info = await FileSystem.getInfoAsync(localUri);
            if (info.exists) photoUris.push(localUri);
          } catch {
            // Unreadable counts as not there.
          }
          continue;
        }
        try {
          const remoteName = uri.split('/').pop() || 'file';
          // Keep the real extension. Forcing .jpg turned every restored PDF
          // into "invoice.pdf.jpg", which isPdf() then failed to recognise.
          const hasExtension = /\.[a-z0-9]{2,5}$/i.test(remoteName);
          const fileId = hasExtension ? remoteName : `${remoteName}.jpg`;
          const targetUri = `${dir}${fileId}`;

          // If file is already cached on local disk from an earlier sync, skip downloading!
          const existingInfo = await FileSystem.getInfoAsync(targetUri);
          if (existingInfo.exists) {
            photoUris.push(targetUri);
            continue;
          }

          const downloaded = await FileSystem.downloadAsync(uri, targetUri, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (downloaded.status !== 200) {
            throw new Error(`download status ${downloaded.status}`);
          }
          photoUris.push(downloaded.uri);
        } catch (err) {
          console.warn('Failed to download photo:', uri, err);
          photoUris.push(uri);
        }
      }
      result.push({ ...item, photoUris });
    }
    return result;
  }, []);

  const pulled = useRef(false);

  /**
   * On sign-in, fold any existing backup into this device.
   *
   * A merge rather than a restore on purpose: someone may have added items
   * before signing in, and those must survive. Runs once per session.
   */
  useEffect(() => {
    if (!ready || !signedIn || !premium || pulled.current) return;
    pulled.current = true;

    void (async () => {
      const token = useCloud ? getIdToken() : await getAccessToken();
      if (!token) return;
      try {
        let remoteWarranty: WarrantyItem[] = [];
        let remoteStorage: StorageItem[] = [];

        if (useCloud) {
          const response = await fetch(`${API_BASE}/backup`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!response.ok) return;
          const data = await response.json() as { items?: unknown };
          const remote = data.items;
          if (!remote || typeof remote !== 'object') return;

          let rawWarranty: WarrantyItem[] = [];
          let rawStorage: StorageItem[] = [];

          if (Array.isArray(remote)) {
            rawWarranty = remote;
          } else {
            const obj = remote as { items?: WarrantyItem[]; storageItems?: StorageItem[] };
            rawWarranty = Array.isArray(obj.items) ? obj.items : [];
            rawStorage = Array.isArray(obj.storageItems) ? obj.storageItems : [];
          }

          remoteWarranty = await downloadPhotos(rawWarranty, token);
          remoteStorage = await downloadPhotos(rawStorage, token);
        } else {
          const remote = await restoreFromDrive(token);
          if (!remote) return;
          remoteWarranty = remote.items;
          remoteStorage = remote.storageItems;
        }

        const addedWarranty = await mergeItems(remoteWarranty);
        const addedStorage = await mergeStorageItems(remoteStorage);
        const totalAdded = addedWarranty + addedStorage;
        if (totalAdded > 0) {
          setMessage(`Added ${totalAdded} item${totalAdded === 1 ? '' : 's'} from your backup`);
        }
      } catch {
        // A failed pull shouldn't block using the app.
      }
    })();
  }, [ready, signedIn, premium, authProvider, useCloud, getIdToken, getAccessToken, mergeItems, mergeStorageItems, downloadPhotos]);

  const backupNow = useCallback(() => run('manual'), [run]);

  const restoreNow = useCallback(async () => {
    const token = useCloud ? getIdToken() : await getAccessToken();
    if (!token) {
      setStatus('error');
      setMessage('Could not reach your backup. Open Settings and sign in again to restore access to Drive.');
      return null;
    }
    setStatus('running');
    try {
      let restoredWarranty: WarrantyItem[] = [];
      let restoredStorage: StorageItem[] = [];

      if (useCloud) {
        const response = await fetch(`${API_BASE}/backup`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) throw new Error(`Restore failed with status ${response.status}`);
        const data = await response.json() as { items?: unknown };
        const remote = data.items;
        if (!remote || typeof remote !== 'object') {
          setStatus('idle');
          setMessage('No backup found yet.');
          return null;
        }

        let rawWarranty: WarrantyItem[] = [];
        let rawStorage: StorageItem[] = [];

        if (Array.isArray(remote)) {
          rawWarranty = remote;
        } else {
          const obj = remote as { items?: WarrantyItem[]; storageItems?: StorageItem[] };
          rawWarranty = Array.isArray(obj.items) ? obj.items : [];
          rawStorage = Array.isArray(obj.storageItems) ? obj.storageItems : [];
        }

        restoredWarranty = await downloadPhotos(rawWarranty, token);
        restoredStorage = await downloadPhotos(rawStorage, token);
      } else {
        const restored = await restoreFromDrive(token);
        if (!restored) {
          setStatus('idle');
          setMessage('No backup found yet.');
          return null;
        }
        restoredWarranty = restored.items;
        restoredStorage = restored.storageItems;
      }

      const addedWarranty = await mergeItems(restoredWarranty);
      const addedStorage = await mergeStorageItems(restoredStorage);
      const totalAdded = addedWarranty + addedStorage;

      photoMap.current = {};
      lastPayload.current = null;
      setStatus('idle');
      setMessage(
        totalAdded === 0
          ? 'Backup already matches what is on this phone.'
          : `Restored ${totalAdded} item${totalAdded === 1 ? '' : 's'}`,
      );
      return totalAdded;
    } catch (error) {
      setStatus('error');
      const errStr = String(error);
      if (errStr.includes('401') || errStr.includes('unauthorized')) {
        promptReauth();
      } else {
        setMessage(errStr);
      }
      return null;
    }
  }, [useCloud, getIdToken, getAccessToken, mergeItems, mergeStorageItems, downloadPhotos]);

  const value = useMemo(
    () => ({ lastBackupAt, status, message, backupNow, restoreNow }),
    [lastBackupAt, status, message, backupNow, restoreNow],
  );

  return <BackupContext value={value}>{children}</BackupContext>;
}

export function useBackup(): BackupContextValue {
  const context = use(BackupContext);
  if (!context) throw new Error('useBackup must be used inside <BackupProvider>');
  return context;
}
