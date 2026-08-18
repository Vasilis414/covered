import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ensurePermission } from './notifications';

export type StorageItemWithExpiry = {
  name: string;
  type: string;
  expiresAt?: string;
};

/**
 * Schedules expiration alerts for parking tickets, event tickets, return windows, etc.
 * Supports both short-term (hours/same day) and long-term (days/weeks away) expiries.
 */
export async function scheduleStorageReminders(item: StorageItemWithExpiry): Promise<string[]> {
  if (!item.expiresAt) return [];

  const expiry = new Date(item.expiresAt);
  const expiryTime = expiry.getTime();
  if (isNaN(expiryTime) || expiryTime <= Date.now()) return [];

  const granted = await ensurePermission();
  if (!granted) return [];

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('storage-reminders', {
      name: 'Storage & ticket reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const ids: string[] = [];
  const diffMs = expiryTime - Date.now();
  const diffHours = diffMs / (1000 * 60 * 60);

  // Short term (< 24 hours away, e.g. parking tickets)
  if (diffHours <= 24) {
    // 1. 30 minutes before
    const thirtyMin = new Date(expiryTime - 30 * 60 * 1000);
    if (thirtyMin.getTime() > Date.now()) {
      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: `⏳ ${item.name} expires in 30 minutes`,
            body: `Valid until ${expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Make sure to renew or return!`,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: thirtyMin,
            channelId: 'storage-reminders',
          },
        });
        ids.push(id);
      } catch {}
    }

    // 2. 10 minutes before
    const tenMin = new Date(expiryTime - 10 * 60 * 1000);
    if (tenMin.getTime() > Date.now()) {
      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: `🚨 ${item.name} expires in 10 minutes!`,
            body: `Ends at ${expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: tenMin,
            channelId: 'storage-reminders',
          },
        });
        ids.push(id);
      } catch {}
    }

    // 3. At expiration
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `⚠️ ${item.name} has expired`,
          body: `Expired at ${expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: expiry,
          channelId: 'storage-reminders',
        },
      });
      ids.push(id);
    } catch {}
  } else {
    // Multi-day term (event tickets, return deadlines, vouchers)
    // 1. 1 day before at 10:00 AM
    const oneDayBefore = new Date(expiryTime - 24 * 60 * 60 * 1000);
    oneDayBefore.setHours(10, 0, 0, 0);
    if (oneDayBefore.getTime() > Date.now()) {
      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: `🎟️ ${item.name} is tomorrow`,
            body: `Valid until ${expiry.toLocaleDateString()} ${expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: oneDayBefore,
            channelId: 'storage-reminders',
          },
        });
        ids.push(id);
      } catch {}
    }

    // 2. Morning of expiry (09:00 AM) or at event time
    const dayOf = new Date(expiryTime);
    if (dayOf.getHours() > 9) {
      dayOf.setHours(9, 0, 0, 0);
    }
    if (dayOf.getTime() > Date.now() && dayOf.getTime() < expiryTime) {
      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: `📌 ${item.name} is today`,
            body: `Expires or takes place at ${expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: dayOf,
            channelId: 'storage-reminders',
          },
        });
        ids.push(id);
      } catch {}
    }
  }

  return ids;
}

export async function cancelStorageReminders(ids?: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  await Promise.all(
    ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})),
  );
}
