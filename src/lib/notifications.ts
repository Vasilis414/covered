import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { REMINDER_OFFSETS, expiryDate, formatDate } from '@/lib/warranty';
import type { WarrantyItem } from '@/types/item';

/** Reminders fire mid-morning rather than at midnight. */
const REMINDER_HOUR = 10;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensurePermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

/**
 * Schedules the 30/7/1-day nudges. Offsets already in the past are skipped, so
 * adding an item that expires next week only books the reminders that can still
 * fire. Returns the ids to store on the item for later cancellation.
 */
export async function scheduleReminders(
  item: Pick<WarrantyItem, 'name' | 'purchaseDate' | 'warrantyMonths'>,
  offsets: readonly number[] = REMINDER_OFFSETS,
): Promise<string[]> {
  const granted = await ensurePermission();
  if (!granted) return [];

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('warranty-reminders', {
      name: 'Warranty reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const expiry = expiryDate(item);
  const ids: string[] = [];

  for (const offset of offsets) {
    const fireAt = new Date(expiry);
    fireAt.setDate(fireAt.getDate() - offset);
    fireAt.setHours(REMINDER_HOUR, 0, 0, 0);
    if (fireAt.getTime() <= Date.now()) continue;

    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title:
            offset === 1
              ? `${item.name}: warranty ends tomorrow`
              : `${item.name}: ${offset} days of warranty left`,
          body: `Cover ends ${formatDate(expiry)}. Worth checking it over while a claim is still free.`,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireAt,
          channelId: 'warranty-reminders',
        },
      });
      ids.push(id);
    } catch {
      // A single failed reminder shouldn't stop the item being saved.
    }
  }

  return ids;
}

export async function cancelReminders(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})),
  );
}
