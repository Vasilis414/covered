import * as FileSystem from 'expo-file-system/legacy';

import { mimeTypeFor } from '@/lib/attachments';
import type { ReceiptScan } from '@/lib/receipt-parse';
import { sanitiseScan } from '@/lib/scan-shape';

/**
 * Talks to the Covered Worker, which holds the Gemini key and enforces the
 * account's scan allowance. The app never sees the key, and a signed-out user
 * simply gets no AI — the on-device parser still works.
 */

export const API_BASE =
  process.env.EXPO_PUBLIC_RECEIPT_AI_ENDPOINT ?? 'https://covered-scan.vas93333.workers.dev';

const TIMEOUT_MS = 30_000;

export type Entitlement = {
  /** Stable per-account id from the server; used as the RevenueCat app user id. */
  userId?: string;
  plan: string;
  paid: boolean;
  expiresAt: string | null;
  scansUsed: number;
  /** null when unlimited (paid). */
  scansRemaining: number | null;
  storageUsed?: number;
  storageLimit?: number;
  email?: string | null;
  /** Set locally after a delete so the UI stops offering paid features. */
  accountDeleted?: boolean;
};

export type ScanOutcome =
  | { ok: true; scan: ReceiptScan }
  | { ok: false; reason: 'limit' | 'auth' | 'network' | 'failed' };

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Why this reports a reason instead of returning null.
 *
 * "The server rejected your token" and "I couldn't reach the server" look
 * identical to a caller that only gets null back, and the only safe response to
 * the first — throw the credential away — is the worst possible response to the
 * second. Collapsing them logged people out for opening the app on a train.
 */
export type EntitlementResult =
  | { ok: true; entitlement: Entitlement }
  | { ok: false; reason: 'auth' | 'network' };

/**
 * Claims the caller's store subscription for their account.
 *
 * One paid subscription entitles one account. The server holds the binding, so
 * restoring a purchase while signed into a different account is refused here
 * rather than quietly giving a second account Pro.
 */
export type LinkSubscriptionResult =
  | { ok: true; expiresAt: string | null }
  | { ok: false; reason: 'already_linked' | 'no_subscription' | 'network' };

export async function linkSubscription(idToken: string): Promise<LinkSubscriptionResult> {
  try {
    return await withTimeout(async (signal) => {
      const response = await fetch(`${API_BASE}/subscription/link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        signal,
      });
      if (response.status === 409) return { ok: false, reason: 'already_linked' } as const;
      if (response.status === 404) return { ok: false, reason: 'no_subscription' } as const;
      if (!response.ok) return { ok: false, reason: 'network' } as const;
      const body = (await response.json()) as { expiresAt?: string | null };
      return { ok: true, expiresAt: body.expiresAt ?? null } as const;
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export async function fetchEntitlement(idToken: string): Promise<EntitlementResult> {
  try {
    return await withTimeout(async (signal) => {
      const response = await fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${idToken}` },
        signal,
      });
      // Only the server actually saying no counts as a bad credential. A 500 is
      // the server having a bad day, and says nothing about the token.
      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: 'auth' } as const;
      }
      if (!response.ok) return { ok: false, reason: 'network' } as const;
      return { ok: true, entitlement: (await response.json()) as Entitlement } as const;
    });
  } catch {
    // Timeout, DNS, aeroplane mode — anything that never reached the Worker.
    return { ok: false, reason: 'network' };
  }
}

export async function scanViaApi(idToken: string, imageUri: string): Promise<ScanOutcome> {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const mimeType = mimeTypeFor(imageUri);

    return await withTimeout(async (signal) => {
      const response = await fetch(`${API_BASE}/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ image: base64, mimeType }),
        signal,
      });

      // 402 is the free allowance being spent — a product state, not an error.
      if (response.status === 402) return { ok: false, reason: 'limit' } as const;
      if (response.status === 401) return { ok: false, reason: 'auth' } as const;
      if (!response.ok) return { ok: false, reason: 'failed' } as const;

      const scan = sanitiseScan(await response.json());
      return scan ? ({ ok: true, scan } as const) : ({ ok: false, reason: 'failed' } as const);
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/** Exchanges a promo code for premium on the signed-in account. */
export async function redeemCode(idToken: string, code: string): Promise<'ok' | 'invalid' | 'error'> {
  try {
    return await withTimeout(async (signal) => {
      const response = await fetch(`${API_BASE}/redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ code }),
        signal,
      });
      if (response.ok) return 'ok' as const;
      if (response.status === 403) return 'invalid' as const;
      return 'error' as const;
    });
  } catch {
    return 'error';
  }
}

/**
 * Tells the server the scan was good enough to keep unedited. Only then does
 * it count against the free allowance.
 */
export async function acceptScan(idToken: string): Promise<void> {
  try {
    await withTimeout(async (signal) => {
      await fetch(`${API_BASE}/scan/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        signal,
      });
    });
  } catch {
    // Failing to charge is harmless — the attempt cap still bounds abuse.
  }
}

export type StorageScanResult = {
  name?: string;
  type?: 'ticket' | 'receipt' | 'barcode' | 'other';
  barcodePayload?: string;
  barcodeFormat?: 'QR_CODE' | 'CODE_128' | 'EAN_13' | 'CODE_39' | 'PDF417' | 'OTHER';
  expiresAt?: string;
  notes?: string;
};

export type StorageScanOutcome =
  | { ok: true; scan: StorageScanResult }
  | { ok: false; reason: 'subscription' | 'auth' | 'network' | 'failed' };

export async function scanStorageViaApi(idToken: string, imageUri: string): Promise<StorageScanOutcome> {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const mimeType = mimeTypeFor(imageUri);

    return await withTimeout(async (signal) => {
      const response = await fetch(`${API_BASE}/storage/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ image: base64, mimeType }),
        signal,
      });

      if (response.status === 402) return { ok: false, reason: 'subscription' } as const;
      if (response.status === 401) return { ok: false, reason: 'auth' } as const;
      if (!response.ok) return { ok: false, reason: 'failed' } as const;

      const raw = (await response.json()) as StorageScanResult;
      return { ok: true, scan: raw } as const;
    });
  } catch {
    return { ok: false, reason: 'network' } as const;
  }
}

/**
 * Permanently deletes the signed-in account on the server.
 *
 * Both app stores require this to be reachable from inside the app, and to
 * actually remove the data rather than just hiding it.
 */
export async function deleteAccount(idToken: string): Promise<'ok' | 'error'> {
  try {
    return await withTimeout(async (signal) => {
      const response = await fetch(`${API_BASE}/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
        signal,
      });
      return response.ok ? 'ok' : 'error';
    });
  } catch {
    return 'error';
  }
}
