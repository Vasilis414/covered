export const CATEGORIES = [
  'Electronics',
  'Appliance',
  'Furniture',
  'Vehicle',
  'Tools',
  /**
   * Subscriptions and services with a term: hosting, domains, extended cover,
   * insurance. They expire on a stated date the same way a warranty does, but
   * had no category to land in — so a receipt for one produced no line items
   * at all rather than an item in the wrong category.
   */
  'Service',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export type WarrantyItem = {
  id: string;
  name: string;
  brand?: string;
  retailer?: string;
  category: Category;
  /** Local calendar date, `YYYY-MM-DD`. */
  purchaseDate: string;
  warrantyMonths: number;
  /**
   * Set only for cover measured in days or weeks, which months can't express
   * ("30 day returns", "6 week guarantee"). When present it wins over
   * warrantyMonths, which stays the default so existing items keep working.
   */
  warrantyDays?: number;
  price?: number;
  serialNumber?: string;
  notes?: string;
  /** Receipts, box shots, the product itself. */
  photoUris: string[];
  /** Where to start a claim — manufacturer support page, usually. */
  claimUrl?: string;
  createdAt: string;
  /** Scheduled reminders, kept so we can cancel them on edit or delete. */
  notificationIds: string[];
};

export type NewWarrantyItem = Omit<WarrantyItem, 'id' | 'createdAt' | 'notificationIds'>;
