import * as FileSystem from 'expo-file-system/legacy';

import { getAiKey, hasAiKey } from '@/lib/ai-config';
import { sanitiseScan } from '@/lib/scan-shape';
import type { ReceiptScan } from '@/lib/receipt-parse';
import { CATEGORIES } from '@/types/item';

/**
 * Reads a receipt with a vision model instead of OCR-plus-regex.
 *
 * Two ways to reach the model:
 *
 *   EXPO_PUBLIC_RECEIPT_AI_ENDPOINT — your own backend, which holds the key.
 *     This is the only shippable option. The app sends the image, the server
 *     talks to Gemini.
 *
 *   EXPO_PUBLIC_GEMINI_API_KEY — calls Gemini directly. DEVELOPMENT ONLY.
 *     Anything EXPO_PUBLIC_* is inlined into the JS bundle, so this key ends up
 *     readable inside the APK. Never ship a build with it set.
 *
 * When neither is configured — or the call fails, or the phone is offline —
 * this returns null and the caller falls back to the on-device parser.
 */

const PROXY_ENDPOINT = process.env.EXPO_PUBLIC_RECEIPT_AI_ENDPOINT;

/**
 * Flash-Lite, not Flash. Measured on a real receipt they returned identical
 * output, but Flash spent 605 thinking tokens billed at $7.50/M to get there —
 * roughly 10x the cost for no gain on what is an extraction task, not a
 * reasoning one.
 */
const MODEL = 'gemini-3.5-flash-lite';

/** The Gemini 2.x generateContent endpoint is retired; this is the current one. */
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1/interactions';

const TIMEOUT_MS = 25_000;

const PROMPT = `You are reading a purchase receipt for a warranty-tracking app.

Extract every physical product or service that was actually purchased. Ignore
subtotals, taxes, discounts, payment lines, card numbers and loyalty messages.

For each product:
- description: the full product name, joining lines that wrap. Do not include
  the quantity prefix or the price.
- price: the price for that line, as a number, no currency symbol.
- brand: the manufacturer if you can tell (from the product name or the shop).
  Omit if unsure.
- category: exactly one of Electronics, Appliance, Furniture, Vehicle, Tools, Other.
- warrantyMonths: how long this product is typically covered, in months. If the
  receipt states a warranty, use that. Extended-cover plans such as AppleCare+
  are 24. Otherwise use a sensible default for the product type.

Also extract the shop name, the purchase date as YYYY-MM-DD, and the grand total.
If a value is not present, omit the field rather than guessing.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    retailer: { type: 'string' },
    purchaseDate: { type: 'string' },
    total: { type: 'number' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          price: { type: 'number' },
          brand: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES] },
          warrantyMonths: { type: 'integer' },
        },
        required: ['description', 'price'],
      },
    },
  },
} as const;

export function isAiAvailable(): boolean {
  return Boolean(PROXY_ENDPOINT || hasAiKey());
}

function mimeTypeFor(uri: string): string {
  const extension = uri.split('.').pop()?.split('?')[0]?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'heic' || extension === 'heif') return 'image/heic';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

export async function aiScanReceipt(imageUri: string): Promise<ReceiptScan | null> {
  if (!isAiAvailable()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const mimeType = mimeTypeFor(imageUri);

    const body = PROXY_ENDPOINT
      ? { image: base64, mimeType }
      : {
          model: MODEL,
          // Stateless: don't leave receipts sitting in Google's interaction store.
          store: false,
          input: [
            {
              type: 'user_input',
              content: [
                { type: 'image', mime_type: mimeType, data: base64 },
                { type: 'text', text: PROMPT },
              ],
            },
          ],
          response_format: [
            { type: 'text', mime_type: 'application/json', schema: RESPONSE_SCHEMA },
          ],
        };

    const response = await fetch(PROXY_ENDPOINT ?? GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header rather than a query param, so the key stays out of URLs and logs.
        ...(PROXY_ENDPOINT ? {} : { 'x-goog-api-key': getAiKey() as string }),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const payload = await response.json();

    // A proxy is expected to return the parsed object directly; Gemini returns
    // a steps timeline, with the JSON inside the model_output text parts.
    const text: string | undefined = Array.isArray(payload?.steps)
      ? payload.steps
          .filter((step: { type?: string }) => step?.type === 'model_output')
          .flatMap((step: { content?: { text?: string }[] }) => step.content ?? [])
          .map((part: { text?: string }) => part?.text)
          .filter(Boolean)
          .join('') || undefined
      : undefined;

    const parsed = text ? JSON.parse(text) : payload;
    const scan = sanitiseScan(parsed);
    return scan;
  } catch {
    // Offline, timed out, rate limited, bad JSON — all handled the same way:
    // hand back nothing so the local parser takes over.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
