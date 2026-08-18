import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { cancelReminders, scheduleReminders } from '@/lib/notifications';
import { deletePhoto } from '@/lib/photos';
import { loadItems, saveItems } from '@/lib/storage';
import { useSettings } from '@/store/settings';
import type { NewWarrantyItem, WarrantyItem } from '@/types/item';

type ItemsContextValue = {
  items: WarrantyItem[];
  ready: boolean;
  addItem: (draft: NewWarrantyItem) => Promise<WarrantyItem>;
  updateItem: (id: string, patch: Partial<NewWarrantyItem>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  /** Wipes every item and its files from this device. */
  clearAll: () => Promise<void>;
  getItem: (id: string) => WarrantyItem | undefined;
  /** Rebuilds every item's reminders — used when the lead times change. */
  rescheduleAll: (offsets: readonly number[]) => Promise<void>;
  /** Replaces the whole library. Destructive — prefer mergeItems. */
  replaceAll: (next: WarrantyItem[]) => Promise<void>;
  /** Folds a backup into what's already here without deleting anything. */
  mergeItems: (incoming: WarrantyItem[]) => Promise<number>;
};

const ItemsContext = createContext<ItemsContextValue | null>(null);

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ItemsProvider({ children }: { children: ReactNode }) {
  const { reminderOffsets } = useSettings();
  const [items, setItems] = useState<WarrantyItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    loadItems().then((loaded) => {
      if (!active) return;
      setItems(loaded);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Single funnel for mutations so persistence can never be forgotten. */
  const commit = useCallback((next: WarrantyItem[]) => {
    setItems(next);
    return saveItems(next);
  }, []);

  const addItem = useCallback(
    async (draft: NewWarrantyItem) => {
      const item: WarrantyItem = {
        ...draft,
        id: createId(),
        createdAt: new Date().toISOString(),
        notificationIds: await scheduleReminders(draft, reminderOffsets),
      };
      await commit([item, ...items]);
      return item;
    },
    [commit, items, reminderOffsets],
  );

  const updateItem = useCallback(
    async (id: string, patch: Partial<NewWarrantyItem>) => {
      const current = items.find((item) => item.id === id);
      if (!current) return;

      const merged: WarrantyItem = { ...current, ...patch };

      // Reminders are derived from the dates, so rebuild them when those move.
      const datesMoved =
        merged.purchaseDate !== current.purchaseDate ||
        merged.warrantyMonths !== current.warrantyMonths ||
        merged.name !== current.name;

      if (datesMoved) {
        await cancelReminders(current.notificationIds);
        merged.notificationIds = await scheduleReminders(merged, reminderOffsets);
      }

      await commit(items.map((item) => (item.id === id ? merged : item)));
    },
    [commit, items, reminderOffsets],
  );

  const removeItem = useCallback(
    async (id: string) => {
      const target = items.find((item) => item.id === id);
      if (target) {
        await cancelReminders(target.notificationIds);
        target.photoUris.forEach(deletePhoto);
      }
      await commit(items.filter((item) => item.id !== id));
    },
    [commit, items],
  );

  /**
   * Erases the whole library from this device. Used by account deletion, where
   * leaving the data behind would make the deletion a lie.
   */
  const clearAll = useCallback(async () => {
    for (const item of items) {
      await cancelReminders(item.notificationIds);
      item.photoUris.forEach(deletePhoto);
    }
    await commit([]);
  }, [commit, items]);

  const getItem = useCallback((id: string) => items.find((item) => item.id === id), [items]);

  const rescheduleAll = useCallback(
    async (offsets: readonly number[]) => {
      const next = await Promise.all(
        items.map(async (item) => {
          await cancelReminders(item.notificationIds);
          return { ...item, notificationIds: await scheduleReminders(item, offsets) };
        }),
      );
      await commit(next);
    },
    [commit, items],
  );

  const replaceAll = useCallback(
    async (next: WarrantyItem[]) => {
      // Reminders belong to the old rows; drop them before the rows go away.
      await Promise.all(items.map((item) => cancelReminders(item.notificationIds)));
      const rescheduled = await Promise.all(
        next.map(async (item) => ({
          ...item,
          notificationIds: await scheduleReminders(item, reminderOffsets),
        })),
      );
      await commit(rescheduled);
    },
    [commit, items, reminderOffsets],
  );

  /**
   * Adds anything from a backup that isn't already here.
   *
   * Never deletes: someone who added items before signing in must not lose
   * them to a restore. On an id collision the local copy wins, because it is
   * the one the user has been looking at.
   */
  const mergeItems = useCallback(
    async (incoming: WarrantyItem[]) => {
      const known = new Set(items.map((item) => item.id));
      const additions = incoming.filter((item) => !known.has(item.id));
      if (additions.length === 0) return 0;

      const scheduled = await Promise.all(
        additions.map(async (item) => ({
          ...item,
          notificationIds: await scheduleReminders(item, reminderOffsets),
        })),
      );

      await commit([...scheduled, ...items]);
      return additions.length;
    },
    [commit, items, reminderOffsets],
  );

  const value = useMemo(
    () => ({ items, ready, addItem, updateItem, removeItem, clearAll, getItem, rescheduleAll, replaceAll, mergeItems }),
    [items, ready, addItem, updateItem, removeItem, clearAll, getItem, rescheduleAll, replaceAll, mergeItems],
  );

  return <ItemsContext value={value}>{children}</ItemsContext>;
}

export function useItems(): ItemsContextValue {
  const context = use(ItemsContext);
  if (!context) throw new Error('useItems must be used inside <ItemsProvider>');
  return context;
}
