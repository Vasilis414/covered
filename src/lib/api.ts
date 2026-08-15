import { File } from 'expo-file-system';

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
  plan: string;
  paid: boolean;
  expiresAt: string | null;
  scansUsed: number;
  /** null when unlimited (paid). */
  scansRemaining: number | null;
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
    const base64 = await new File(imageUri).base64();
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
