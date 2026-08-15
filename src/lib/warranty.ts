import { getLocales } from 'expo-localization';

import type { WarrantyItem } from '@/types/item';

export type WarrantyStatus = 'active' | 'expiring' | 'expired';

/** Anything inside this window counts as "expiring soon". */
export const EXPIRING_SOON_DAYS = 30;

/** Days before expiry that we nudge the user. */
export const REMINDER_OFFSETS = [30, 7, 1] as const;

const MS_PER_DAY = 86_400_000;

export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function toISODate(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * Purchase date plus the warranty length. Clamps to the last day of the month
 * so a 1-month warranty bought on Jan 31 expires Feb 28, not Mar 3.
 */
export function expiryDate(
  item: Pick<WarrantyItem, 'purchaseDate' | 'warrantyMonths'> & { warrantyDays?: number },
): Date {
  const start = parseLocalDate(item.purchaseDate);

  // Day- and week-length cover is exact, so it bypasses the month arithmetic.
  if (item.warrantyDays && item.warrantyDays > 0) {
    const exact = new Date(start);
    exact.setDate(exact.getDate() + item.warrantyDays);
    return exact;
  }

  const target = new Date(start);
  target.setMonth(target.getMonth() + item.warrantyMonths);
  if (target.getDate() !== start.getDate()) target.setDate(0);
  return target;
}

/** Whole days until the warranty lapses. Negative once it has. */
export function daysRemaining(
  item: Pick<WarrantyItem, 'purchaseDate' | 'warrantyMonths'> & { warrantyDays?: number },
): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((expiryDate(item).getTime() - today.getTime()) / MS_PER_DAY);
}

export function statusOf(
  item: Pick<WarrantyItem, 'purchaseDate' | 'warrantyMonths'> & { warrantyDays?: number },
): WarrantyStatus {
  const days = daysRemaining(item);
  if (days < 0) return 'expired';
  if (days <= EXPIRING_SOON_DAYS) return 'expiring';
  return 'active';
}

export function formatRemaining(days: number): string {
  if (days < 0) {
    const past = Math.abs(days);
    if (past >= 365) return `Expired ${Math.floor(past / 365)}y ago`;
    if (past >= 30) return `Expired ${Math.floor(past / 30)}mo ago`;
    return past === 1 ? 'Expired yesterday' : `Expired ${past} days ago`;
  }
  if (days === 0) return 'Expires today';
  if (days === 1) return '1 day left';
  if (days < 60) return `${days} days left`;
  // Months stay useful up to about a year and a half; past that, years read better.
  if (days < 547) return `${Math.round(days / 30)} months left`;
  return `${Math.round(days / 365)} years left`;
}

/** Human wording for a day-based length, used by custom cover. */
export function formatWarrantyDays(days: number): string {
  if (days % 365 === 0) {
    const years = days / 365;
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  if (days % 7 === 0) {
    const weeks = days / 7;
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function formatWarrantyLength(months: number): string {
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  return `${months} months`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Falls back to USD only when the device reports no regional currency. */
const CURRENCY = getLocales()[0]?.currencyCode ?? 'USD';

export function formatPrice(amount: number): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}
