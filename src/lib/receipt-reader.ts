import { aiScanReceipt, isAiAvailable } from '@/lib/ai-receipt';
import { scanViaApi } from '@/lib/api';
import { scanReceipt } from '@/lib/ocr';
import type { ReceiptScan } from '@/lib/receipt-parse';

export type ReadSource = 'ai' | 'device';

export type ReceiptReading = {
  scan: ReceiptScan | null;
  source: ReadSource;
  /** True when the account's AI allowance is spent — the moment to upsell. */
  limitReached?: boolean;
};

/**
 * Reads a receipt with the best method available, in order:
 *
 *   1. The Covered API, when signed in. The server holds the key and decides
 *      whether this account still has scans.
 *   2. A per-device Gemini key, if one was pasted in Settings.
 *   3. On-device text recognition, for premium accounts only — it is the
 *      offline fallback, not a free alternative to the paid feature.
 */
export async function readReceipt(
  uri: string,
  idToken?: string,
  /** Free accounts get the API's one taster scan and nothing else. */
  allowDeviceFallback = true,
): Promise<ReceiptReading> {
  if (idToken) {
    const outcome = await scanViaApi(idToken, uri);
    if (outcome.ok) return { scan: outcome.scan, source: 'ai' };
    if (outcome.reason === 'limit') {
      return { scan: null, source: 'device', limitReached: true };
    }
    // auth/network/failed all fall through to the local paths below.
  }

  if (isAiAvailable()) {
    const ai = await aiScanReceipt(uri);
    if (ai) return { scan: ai, source: 'ai' };
  }

  if (!allowDeviceFallback) return { scan: null, source: 'device' };

  return { scan: await scanReceipt(uri), source: 'device' };
}
