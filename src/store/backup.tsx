import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { AppState } from 'react-native';

import { backupToDrive, restoreFromDrive } from '@/lib/drive-backup';
import { useAuth } from '@/store/auth';
import { useItems } from '@/store/items';
import type { WarrantyItem } from '@/types/item';

const STATE_KEY = 'covered.backup.state.v1';
/** Wait for edits to settle rather than uploading on every keystroke-driven save. */
const DEBOUNCE_MS = 8_000;

type PersistedState = {
  lastBackupAt?: string;
  /** Local photo uri -> Drive file id, so unchanged photos aren't re-uploaded. */
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

export function BackupProvider({ children }: { children: ReactNode }) {
  const { items, ready, mergeItems } = useItems();
  const { entitlement, getAccessToken, signedIn } = useAuth();

  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const photoMap = useRef<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  /** Snapshot of what was last uploaded, so we skip no-op backups. */
  const lastPayload = useRef<string | null>(null);

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

      const payload = JSON.stringify(items);
      // Nothing changed since the last upload, so don't spend the round trip.
      if (reason === 'auto' && payload === lastPayload.current) return;

      const token = await getAccessToken();
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
        const { result, photoMap: updated } = await backupToDrive(token, items, photoMap.current);
        photoMap.current = updated;
        lastPayload.current = payload;
        await persist(result.updatedAt);

        const summary =
          `Backed up ${result.itemCount} item${result.itemCount === 1 ? '' : 's'}` +
          (result.photoCount
            ? ` and ${result.photoCount} new file${result.photoCount === 1 ? '' : 's'}`
            : '');

        /**
         * A partial backup is reported as a problem, not a success. It used to
         * say "Backed up 4 items" whether or not every attachment made it, so a
         * receipt that failed to upload looked exactly like one that didn't.
         */
        if (result.failed.length > 0) {
          setStatus('error');
          setMessage(
            `${summary}, but ${result.failed.length} file${result.failed.length === 1 ? '' : 's'} could not be saved: ${result.failed.join(', ')}`,
          );
        } else {
          setStatus('idle');
          setMessage(summary);
        }
      } catch (error) {
        setStatus('error');
        setMessage(String(error));
      } finally {
        running.current = false;
      }
    },
    [premium, items, getAccessToken, persist],
  );

  // Auto-backup: debounce so a burst of edits produces one upload.
  useEffect(() => {
    if (!ready || !premium) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run('auto'), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [items, ready, premium, run]);

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
      const token = await getAccessToken();
      if (!token) return;
      try {
        const remote = await restoreFromDrive(token);
        if (!remote?.length) return;
        const added = await mergeItems(remote);
        if (added > 0) {
          setMessage(`Added ${added} item${added === 1 ? '' : 's'} from your backup`);
        }
      } catch {
        // A failed pull shouldn't block using the app; the manual button remains.
      }
    })();
  }, [ready, signedIn, premium, getAccessToken, mergeItems]);

  const backupNow = useCallback(() => run('manual'), [run]);

  const restoreNow = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setStatus('error');
      setMessage('Could not reach your backup — sign out and back in, then try again.');
      return null;
    }
    setStatus('running');
    try {
      const restored: WarrantyItem[] | null = await restoreFromDrive(token);
      if (!restored) {
        setStatus('idle');
        setMessage('No backup found yet.');
        return null;
      }
      const added = await mergeItems(restored);
      // Restored photos are new local files; the old mapping no longer applies.
      photoMap.current = {};
      lastPayload.current = null;
      setStatus('idle');
      setMessage(
        added === 0
          ? 'Backup already matches what is on this phone.'
          : `Restored ${added} item${added === 1 ? '' : 's'}`,
      );
      return added;
    } catch (error) {
      setStatus('error');
      setMessage(String(error));
      return null;
    }
  }, [getAccessToken, mergeItems]);

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
