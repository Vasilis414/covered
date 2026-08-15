/**
 * Turns the raw text ML Kit reads off a receipt into the three fields worth
 * pre-filling: when it was bought, what it cost, and who sold it.
 *
 * Deliberately dependency-free and pure so it can be reasoned about and tested
 * without a camera or a device.
 */

import { inferBrand, inferCategory, inferWarrantyMonths } from './product-inference';
import type { Category } from '@/types/item';

export type ReceiptLineItem = {
  description: string;
  price: number;
  /** Inferred locally from the product name — see product-inference.ts. */
  brand?: string;
  category?: Category;
  warrantyMonths?: number;
};

export type ReceiptScan = {
  purchaseDate?: string;
  price?: number;
  retailer?: string;
  /** The individual products billed, so a multi-item receipt can be split up. */
  lineItems: ReceiptLineItem[];
};

export type ParseOptions = {
  /** US-style MM/DD, used only to break genuinely ambiguous dates like 03/04. */
  prefersMonthFirst?: boolean;
  /** Injectable for testing. */
  today?: Date;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Receipts older than this are almost certainly a misread, not a purchase. */
const MAX_AGE_YEARS = 30;

function pad(value: number): string {
  return `${value}`.padStart(2, '0');
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function expandYear(year: number): number {
  if (year >= 1000) return year;
  // A two-digit year on a receipt is this century.
  return 2000 + year;
}

function collectDates(text: string, options: ParseOptions): string[] {
  const found: string[] = [];

  // 2026-08-12 — unambiguous, so handle it first.
  for (const match of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const [, y, m, d] = match.map(Number);
    if (isValidYmd(y, m, d)) found.push(`${y}-${pad(m)}-${pad(d)}`);
  }

  // 12/08/2026, 12.08.26, 8-12-2026
  for (const match of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = expandYear(Number(match[3]));

    // Whichever number can't be a month settles the order; otherwise fall back
    // to the device's regional convention.
    const monthFirst = second > 12 ? true : first > 12 ? false : Boolean(options.prefersMonthFirst);
    const month = monthFirst ? first : second;
    const day = monthFirst ? second : first;

    if (isValidYmd(year, month, day)) found.push(`${year}-${pad(month)}-${pad(day)}`);
  }

  // 12 Aug 2026 / 12th August 26 / 14. Februar 2026.
  // Separators deliberately exclude newlines: letting \s cross lines lets a
  // price on one line pair with a word on the next, and the bogus match eats
  // the real date that follows it.
  for (const match of text.matchAll(
    /\b(\d{1,2})(?:st|nd|rd|th)?[ \t.,-]{0,3}([A-Za-z]{3,9})\.?,?[ \t-]{0,3}(\d{2,4})\b/g,
  )) {
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    const day = Number(match[1]);
    const year = expandYear(Number(match[3]));
    if (month && isValidYmd(year, month, day)) found.push(`${year}-${pad(month)}-${pad(day)}`);
  }

  // Aug 12, 2026
  for (const match of text.matchAll(
    /\b([A-Za-z]{3,9})\.?[ \t-]{1,3}(\d{1,2})(?:st|nd|rd|th)?,?[ \t-]{1,3}(\d{2,4})\b/g,
  )) {
    const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
    const day = Number(match[2]);
    const year = expandYear(Number(match[3]));
    if (month && isValidYmd(year, month, day)) found.push(`${year}-${pad(month)}-${pad(day)}`);
  }

  return found;
}

function pickPurchaseDate(text: string, options: ParseOptions): string | undefined {
  const today = options.today ?? new Date();
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const oldest = new Date(today);
  oldest.setFullYear(oldest.getFullYear() - MAX_AGE_YEARS);
  const oldestIso = `${oldest.getFullYear()}-${pad(oldest.getMonth() + 1)}-${pad(oldest.getDate())}`;

  // ISO strings sort chronologically, so plain comparison is enough. Future
  // dates are return-by or best-before lines, never the purchase.
  const plausible = collectDates(text, options).filter((iso) => iso <= todayIso && iso >= oldestIso);
  if (plausible.length === 0) return undefined;

  return plausible.sort().at(-1);
}

/** Handles both 1,234.56 and the European 1.234,56. */
function parseMoney(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return undefined;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalised: string;

  if (lastComma > lastDot) {
    normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalised = cleaned.replace(/,/g, '');
  }

  const value = Number(normalised);
  return Number.isFinite(value) ? value : undefined;
}

const MONEY = /(?:[£$€]\s?)?\d{1,3}(?:[,\s]\d{3})*[.,]\d{2}\b|(?:[£$€]\s?)\d+(?:[.,]\d{2})?/g;

function moneyOn(line: string): number[] {
  return (line.match(MONEY) ?? [])
    .map(parseMoney)
    .filter((value): value is number => value !== undefined && value > 0);
}

function pickPrice(lines: string[]): number | undefined {
  // "Subtotal" and tax lines look like totals but aren't what was paid.
  const totalLine = /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|total\s*to\s*pay|amount\s*paid|total)\b/i;
  const notTotal = /\b(sub\s*-?\s*total|vat|tax|change|savings?|discount|tender)\b/i;

  const candidates = lines
    .filter((line) => totalLine.test(line) && !notTotal.test(line))
    .flatMap(moneyOn);

  if (candidates.length > 0) return Math.max(...candidates);

  // No labelled total — the largest amount on the receipt is the best guess.
  const all = lines.flatMap(moneyOn);
  return all.length > 0 ? Math.max(...all) : undefined;
}

// Note: "store" is deliberately absent — plenty of shops are called one
// ("Apple Store"), and a bare "Store #123" line is already dropped for digits.
const NOT_A_NAME =
  /\b(receipt|invoice|vat|tax|tel|phone|www|http|order|customer|copy|no\.?|date|time|till|reg)\b/i;

/** Summary, payment and total lines that look like products but aren't. */
const NOT_A_PRODUCT =
  /\b(sub\s*-?\s*total|total|tax|vat|amount\s*(due|charged|paid)|balance|change|tender|card\s*type|account|auth|discount|savings?|subtotal)\b/i;

/**
 * Pulls out the individual products billed. A receipt for a phone, a case and
 * an AppleCare plan is three warranties, not one, so the user needs to say
 * which of them this item is.
 */
function pickLineItems(lines: string[]): ReceiptLineItem[] {
  const items: ReceiptLineItem[] = [];
  /** Index of the line that produced the last item, for continuation merging. */
  let lastItemLine = -2;

  lines.forEach((line, index) => {
    if (NOT_A_PRODUCT.test(line)) return;

    const amounts = line.match(MONEY);

    if (!amounts?.length) {
      // A price-less line straight after an item is usually the rest of its
      // name wrapping — "iPhone 15 Pro 256GB" / "Natural Titanium".
      const previous = items[items.length - 1];
      const isContinuation =
        previous !== undefined &&
        index === lastItemLine + 1 &&
        line.length <= 40 &&
        !/\d{2}/.test(line) &&
        line.replace(/[^A-Za-z]/g, '').length >= 3;

      if (isContinuation && previous) {
        previous.description = `${previous.description} ${line.trim()}`.trim();
        lastItemLine = index;
      }
      return;
    }

    const last = amounts[amounts.length - 1];
    const price = parseMoney(last);
    if (price === undefined || price <= 0) return;

    const description = line
      .slice(0, line.lastIndexOf(last))
      // Receipts prefix a quantity; it isn't part of the product name.
      .replace(/^\s*\d+\s*[xX*]?\s+/, '')
      .replace(/[.\s·–-]+$/, '')
      .trim();

    const letters = description.replace(/[^A-Za-z]/g, '').length;
    if (letters < 3 || description.length > 60) return;

    items.push({ description, price });
    lastItemLine = index;
  });

  return items;
}

function pickRetailer(lines: string[]): string | undefined {
  // Shop names sit at the very top, above the address and the transaction guff.
  for (const line of lines.slice(0, 6)) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 40) continue;
    if (NOT_A_NAME.test(trimmed)) continue;
    if (/\d/.test(trimmed)) continue;

    const letters = trimmed.replace(/[^A-Za-z]/g, '').length;
    if (letters < 3 || letters / trimmed.length < 0.6) continue;

    // Receipts shout; normalise so it doesn't look shouted in the app.
    const isShouting = trimmed === trimmed.toUpperCase();
    return isShouting
      ? trimmed
          .toLowerCase()
          .replace(/\b[a-z]/g, (char) => char.toUpperCase())
      : trimmed;
  }
  return undefined;
}

export function parseReceipt(text: string, options: ParseOptions = {}): ReceiptScan {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const retailer = pickRetailer(lines);

  // Enrich each product with what can be worked out locally: who made it, what
  // kind of thing it is, and how long it's likely covered for.
  const lineItems = pickLineItems(lines).map((item) => {
    const category = inferCategory(item.description);
    return {
      ...item,
      brand: inferBrand(item.description, retailer),
      category,
      warrantyMonths: inferWarrantyMonths(item.description, text, category),
    };
  });

  return {
    purchaseDate: pickPurchaseDate(text, options),
    price: pickPrice(lines),
    retailer,
    lineItems,
  };
}
