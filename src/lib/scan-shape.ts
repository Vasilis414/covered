import type { ReceiptLineItem, ReceiptScan } from '@/lib/receipt-parse';
import { CATEGORIES, type Category } from '@/types/item';

/**
 * Validates whatever the model returned before it reaches app state.
 *
 * The schema tells Gemini what to produce; this makes sure a bad response
 * can't write nonsense into someone's warranty records. Shared by the direct
 * Gemini path and the Worker path so both are held to the same standard.
 */
export function sanitiseScan(raw: unknown): ReceiptScan | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;

  const lineItems: ReceiptLineItem[] = Array.isArray(data.lineItems)
    ? data.lineItems.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;

        const description = typeof item.description === 'string' ? item.description.trim() : '';
        const price = typeof item.price === 'number' ? item.price : Number(item.price);
        if (!description || !Number.isFinite(price) || price <= 0) return [];

        const category =
          typeof item.category === 'string' && (CATEGORIES as readonly string[]).includes(item.category)
            ? (item.category as Category)
            : undefined;

        const months = Number(item.warrantyMonths);

        return [
          {
            description,
            price,
            brand:
              typeof item.brand === 'string' && item.brand.trim() ? item.brand.trim() : undefined,
            category,
            warrantyMonths:
              Number.isInteger(months) && months > 0 && months <= 120 ? months : undefined,
          },
        ];
      })
    : [];

  const purchaseDate =
    typeof data.purchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.purchaseDate)
      ? data.purchaseDate
      : undefined;

  const total = typeof data.total === 'number' && data.total > 0 ? data.total : undefined;

  const scan: ReceiptScan = {
    retailer:
      typeof data.retailer === 'string' && data.retailer.trim() ? data.retailer.trim() : undefined,
    purchaseDate,
    price: total,
    lineItems,
  };

  return scan.lineItems.length > 0 || scan.retailer || scan.purchaseDate ? scan : null;
}
