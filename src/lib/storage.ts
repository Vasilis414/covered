import AsyncStorage from '@react-native-async-storage/async-storage';

import { resolvePhotoUris } from '@/lib/photos';
import type { WarrantyItem } from '@/types/item';

const KEY = 'covered.items.v1';

/**
 * The whole library lives in one JSON blob. Fine for the hundreds of items a
 * household actually has; swap the two functions below for SQLite if that ever
 * stops being true.
 */
export async function loadItems(): Promise<WarrantyItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    /**
     * Attachment paths are rebased on load. They were written against whatever
     * app container existed at the time, and iOS issues a new one on every
     * reinstall — so a stored path from a previous install points nowhere.
     */
    return (parsed as WarrantyItem[]).map((item) => ({
      ...item,
      photoUris: resolvePhotoUris(item.photoUris),
    }));
  } catch {
    return [];
  }
}

export async function saveItems(items: WarrantyItem[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}
