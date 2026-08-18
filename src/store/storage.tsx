import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { deletePhoto, resolvePhotoUris } from '@/lib/photos';
import { cancelStorageReminders, scheduleStorageReminders } from '@/lib/storage-notifications';

export type StorageItem = {
  id: string;
  name: string;
  type: 'ticket' | 'receipt' | 'barcode' | 'other';
  photoUris: string[];
  notes?: string;
  barcodePayload?: string;
  barcodeFormat?: 'QR_CODE' | 'CODE_128' | 'EAN_13' | 'CODE_39' | 'PDF417' | 'OTHER';
  expiresAt?: string;
  notificationIds?: string[];
  createdAt: string;
};

export type NewStorageItem = Omit<StorageItem, 'id' | 'createdAt'>;

type StorageContextValue = {
  storageItems: StorageItem[];
  ready: boolean;
  addStorageItem: (draft: NewStorageItem) => Promise<StorageItem>;
  updateStorageItem: (id: string, patch: Partial<NewStorageItem>) => Promise<void>;
  removeStorageItem: (id: string) => Promise<void>;
  /** Wipes every stored item and its files from this device. */
  clearAllStorage: () => Promise<void>;
  getStorageItem: (id: string) => StorageItem | undefined;
  replaceAllStorage: (next: StorageItem[]) => Promise<void>;
  mergeStorageItems: (incoming: StorageItem[]) => Promise<number>;
};

const StorageContext = createContext<StorageContextValue | null>(null);

const STORAGE_KEY = 'covered.storage.items.v1';

function createId(): string {
  return `storage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function StorageProvider({ children }: { children: ReactNode }) {
  const [storageItems, setStorageItems] = useState<StorageItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!active) return;
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        // Same rebasing as the warranty library — see resolvePhotoUris.
        setStorageItems(
          Array.isArray(parsed)
            ? (parsed as StorageItem[]).map((item) => ({
                ...item,
                photoUris: resolvePhotoUris(item.photoUris),
              }))
            : [],
        );
      } catch {
        setStorageItems([]);
      }
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const commit = useCallback((next: StorageItem[]) => {
    setStorageItems(next);
    return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const addStorageItem = useCallback(
    async (draft: NewStorageItem) => {
      const notificationIds = await scheduleStorageReminders(draft);
      const item: StorageItem = {
        ...draft,
        id: createId(),
        notificationIds,
        createdAt: new Date().toISOString(),
      };
      await commit([item, ...storageItems]);
      return item;
    },
    [commit, storageItems],
  );

  const updateStorageItem = useCallback(
    async (id: string, patch: Partial<NewStorageItem>) => {
      const current = storageItems.find((item) => item.id === id);
      if (!current) return;
      if (current.notificationIds) {
        await cancelStorageReminders(current.notificationIds);
      }
      const notificationIds = await scheduleStorageReminders({ ...current, ...patch });
      const merged: StorageItem = { ...current, ...patch, notificationIds };
      await commit(storageItems.map((item) => (item.id === id ? merged : item)));
    },
    [commit, storageItems],
  );

  /** See the note on clearAll in the items store — same contract. */
  const clearAllStorage = useCallback(async () => {
    for (const item of storageItems) {
      await cancelStorageReminders(item.notificationIds);
      item.photoUris.forEach(deletePhoto);
    }
    await commit([]);
  }, [storageItems, commit]);

  const removeStorageItem = useCallback(
    async (id: string) => {
      const target = storageItems.find((item) => item.id === id);
      if (target) {
        target.photoUris.forEach(deletePhoto);
        if (target.notificationIds) {
          await cancelStorageReminders(target.notificationIds);
        }
      }
      await commit(storageItems.filter((item) => item.id !== id));
    },
    [commit, storageItems],
  );

  const getStorageItem = useCallback((id: string) => storageItems.find((item) => item.id === id), [storageItems]);

  const replaceAllStorage = useCallback(
    async (next: StorageItem[]) => {
      await commit(next);
    },
    [commit],
  );

  const mergeStorageItems = useCallback(
    async (incoming: StorageItem[]) => {
      const known = new Set(storageItems.map((item) => item.id));
      const additions = incoming.filter((item) => !known.has(item.id));
      if (additions.length === 0) return 0;
      await commit([...additions, ...storageItems]);
      return additions.length;
    },
    [commit, storageItems],
  );

  const value = useMemo(
    () => ({
      storageItems,
      ready,
      addStorageItem,
      updateStorageItem,
      removeStorageItem,
      clearAllStorage,
      getStorageItem,
      replaceAllStorage,
      mergeStorageItems,
    }),
    [storageItems, ready, addStorageItem, updateStorageItem, removeStorageItem, clearAllStorage, getStorageItem, replaceAllStorage, mergeStorageItems],
  );

  return <StorageContext value={value}>{children}</StorageContext>;
}

export function useStorage(): StorageContextValue {
  const context = use(StorageContext);
  if (!context) throw new Error('useStorage must be used inside <StorageProvider>');
  return context;
}
