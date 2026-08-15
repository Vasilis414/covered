import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
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
import { AppState, Platform } from 'react-native';

import { API_BASE } from '@/lib/api';
import { mimeTypeFor } from '@/lib/attachments';
import { backupToDrive, restoreFromDrive, DRIVE_SCOPE } from '@/lib/drive-backup';
import { useAuth } from '@/store/auth';
import { useItems } from '@/store/items';
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
  const base64 = await new File(localUri).base64();
  const name = localUri.split('/').pop() || 'upload';
  const mimeType = mimeTypeFor(localUri);

  const response = await fetch(`${API_BASE}/storage/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ name, mimeType, content: base64 })
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error((errorBody as { error?: string }).error || `Upload failed with status ${response.status}`);
  }

  const result = (await response.json()) as { url: string };
  return result.url;
}

export function BackupProvider({ children }: { children: ReactNode }) {
  const { items, ready: itemsReady, mergeItems } = useItems();
  const { storageItems, ready: storageReady, mergeStorageItems } = useStorage();
  const { entitlement, getAccessToken, getIdToken, signedIn, authProvider } = useAuth();

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

      const token = authProvider === 'plenum' ? getIdToken() : await getAccessToken();
      if (!token) {
        if (reason === 'manual') {
          setStatus('error');
          setMessage('Could not reach your backup — sign out and back in, then try again.');
        }
        return;
      }

      running.current = true;
      setStatus('running');
      try {
        if (authProvider === 'plenum') {
          const failed: string[] = [];
          let uploaded = 0;
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
                try {
                  const serverUrl = await uploadFileToServer(token, uri);
                  updatedPhotoMap[uri] = serverUrl;
                  photoUris.push(serverUrl);
                  uploaded += 1;
                } catch {
                  failed.push(item.name.slice(0, 30));
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

          const summary =
            `Backed up ${backupResult.itemCount} item${backupResult.itemCount === 1 ? '' : 's'}` +
            (uploaded ? ` and ${uploaded} new file${uploaded === 1 ? '' : 's'}` : '');

          if (failed.length > 0) {
            setStatus('error');
            setMessage(`${summary}, but ${failed.length} file${failed.length === 1 ? '' : 's'} could not be saved.`);
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
          setMessage('Your session has expired. Please sign out and sign back in to renew your connection.');
        } else {
          setMessage(errStr);
        }
      } finally {
        running.current = false;
      }
    },
    [premium, items, storageItems, authProvider, getIdToken, getAccessToken, persist],
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
      const token = authProvider === 'plenum' ? getIdToken() : await getAccessToken();
      if (!token) return;
      try {
        let remoteWarranty: WarrantyItem[] = [];
        let remoteStorage: StorageItem[] = [];

        if (authProvider === 'plenum') {
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

          remoteWarranty = rawWarranty;
          remoteStorage = rawStorage;
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
  }, [ready, signedIn, premium, authProvider, getIdToken, getAccessToken, mergeItems, mergeStorageItems]);

  const backupNow = useCallback(() => run('manual'), [run]);

  const restoreNow = useCallback(async () => {
    const token = authProvider === 'plenum' ? getIdToken() : await getAccessToken();
    if (!token) {
      setStatus('error');
      setMessage('Could not reach your backup — sign out and back in, then try again.');
      return null;
    }
    setStatus('running');
    try {
      let restoredWarranty: WarrantyItem[] = [];
      let restoredStorage: StorageItem[] = [];

      if (authProvider === 'plenum') {
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

        const downloadPhotos = async <T extends { photoUris: string[]; id: string }>(list: T[]): Promise<T[]> => {
          const result: T[] = [];
          for (const item of list) {
            const photoUris: string[] = [];
            for (const uri of item.photoUris) {
              if (uri.startsWith('file://')) {
                photoUris.push(uri);
                continue;
              }
              try {
                const fileId = uri.split('/').pop() || '';
                const fileResponse = await fetch(uri, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (!fileResponse.ok) throw new Error('File download failed');
                const blob = await fileResponse.blob();
                const base64 = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const res = reader.result as string;
                    resolve(res.split(',')[1]);
                  };
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                });

                const extension = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
                const target = new File(Paths.document, 'photos', `${fileId}.${extension}`);
                await target.parentDirectory.create({ intermediates: true, idempotent: true });
                await target.write(base64, { encoding: 'base64' });
                photoUris.push(target.uri);
              } catch {
                photoUris.push(uri);
              }
            }
            result.push({ ...item, photoUris });
          }
          return result;
        };

        restoredWarranty = await downloadPhotos(rawWarranty);
        restoredStorage = await downloadPhotos(rawStorage);
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
        setMessage('Your session has expired. Please sign out and sign back in to renew your connection.');
      } else {
        setMessage(errStr);
      }
      return null;
    }
  }, [authProvider, getIdToken, getAccessToken, mergeItems, mergeStorageItems]);

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
