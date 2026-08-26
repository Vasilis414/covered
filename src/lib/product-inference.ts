import type { Category } from '@/types/item';

/**
 * Cheap, offline stand-ins for the reasoning an LLM would do: work out the
 * brand, the category and a sensible warranty length from a product name.
 *
 * Deliberately dependency-free so it can be unit tested without a device.
 */

/** Matched case-insensitively against the product name and the shop name. */
const BRANDS = [
  'Apple', 'Samsung', 'Sony', 'LG', 'Bosch', 'Siemens', 'Miele', 'Neff', 'AEG',
  'Zanussi', 'Hotpoint', 'Indesit', 'Beko', 'Whirlpool', 'Hoover', 'Dyson',
  'Shark', 'Ninja', 'Philips', 'Braun', 'Panasonic', 'Toshiba', 'Sharp',
  'Hisense', 'TCL', 'Nintendo', 'Microsoft', 'Google', 'Dell', 'HP', 'Lenovo',
  'Asus', 'Acer', 'MSI', 'Razer', 'Logitech', 'Anker', 'Bose', 'Sonos', 'JBL',
  'Sennheiser', 'Garmin', 'Fitbit', 'GoPro', 'Canon', 'Nikon', 'Fujifilm',
  'DeWalt', 'Makita', 'Ryobi', 'Stanley', 'Karcher', 'Einhell', 'Husqvarna',
  'Xiaomi', 'Huawei', 'OnePlus', 'Motorola', 'Nokia', 'Roborock', 'iRobot',
  'Tefal', 'DeLonghi', 'Nespresso', 'Russell Hobbs', 'Kenwood', 'Smeg', 'IKEA',
  'Habitat', 'Bialetti', 'Instant Pot', 'Weber', 'Yamaha', 'Epson', 'Brother',
];

const CATEGORY_KEYWORDS: { category: Category; words: string[] }[] = [
  {
    category: 'Electronics',
    words: [
      'iphone', 'phone', 'smartphone', 'ipad', 'tablet', 'laptop', 'macbook',
      'notebook', 'desktop', 'imac', 'pc', 'monitor', 'display', 'tv',
      'television', 'headphone', 'earbud', 'airpod', 'speaker', 'soundbar',
      'camera', 'lens', 'console', 'playstation', 'xbox', 'switch', 'watch',
      'router', 'keyboard', 'mouse', 'printer', 'ssd', 'hard drive', 'charger',
      'cable', 'adapter', 'powerbank', 'kindle',
    ],
  },
  {
    category: 'Appliance',
    words: [
      'dishwasher', 'washing machine', 'washer', 'dryer', 'fridge',
      'refrigerator', 'freezer', 'oven', 'cooker', 'hob', 'microwave',
      'kettle', 'toaster', 'coffee', 'espresso', 'blender', 'mixer',
      'vacuum', 'hoover', 'air fryer', 'extractor', 'boiler', 'heater',
      'air conditioner', 'dehumidifier', 'iron',
    ],
  },
  {
    category: 'Furniture',
    words: [
      'sofa', 'couch', 'armchair', 'chair', 'stool', 'table', 'desk', 'bed',
      'mattress', 'wardrobe', 'dresser', 'cabinet', 'bookcase', 'shelf',
      'sideboard', 'nightstand',
    ],
  },
  {
    category: 'Tools',
    words: [
      'drill', 'driver', 'saw', 'sander', 'grinder', 'wrench', 'spanner',
      'hammer', 'lawnmower', 'mower', 'trimmer', 'chainsaw', 'compressor',
      'pressure washer', 'multi-tool', 'toolkit', 'workbench',
    ],
  },
  {
    category: 'Vehicle',
    words: ['car', 'bicycle', 'bike', 'scooter', 'tyre', 'tire', 'moped', 'motorcycle'],
  },
];

/** Cover that a product line itself declares, e.g. "AppleCare+ … 2 years". */
const PROTECTION_PLAN = /\b(applecare|extended warranty|protection plan|care plan|cover plan|guarantee plan)\b/i;

/** Warranty length written in plain words anywhere on the receipt. */
const WARRANTY_TEXT = /(\d{1,2})\s*[-–]?\s*(year|yr|month|mo)s?\b[^.\n]{0,20}\b(warranty|guarantee|cover)\b/i;

export function inferBrand(productName: string, retailer?: string): string | undefined {
  const haystacks = [productName, retailer ?? ''];
  for (const brand of BRANDS) {
    const pattern = new RegExp(`\\b${brand.replace(/[+]/g, '\\+')}\\b`, 'i');
    if (haystacks.some((text) => pattern.test(text))) return brand;
  }
  return undefined;
}

export function inferCategory(productName: string): Category | undefined {
  const text = productName.toLowerCase();
  for (const { category, words } of CATEGORY_KEYWORDS) {
    if (words.some((word) => text.includes(word))) return category;
  }
  return undefined;
}

/**
 * A warranty length in months, preferring what the receipt actually says over
 * a guess from the category.
 */
export function inferWarrantyMonths(
  productName: string,
  receiptText = '',
  category?: Category,
): number | undefined {
  // "AppleCare+" and friends are two years as sold in most markets.
  if (PROTECTION_PLAN.test(productName)) return 24;

  const stated = receiptText.match(WARRANTY_TEXT);
  if (stated) {
    const amount = Number(stated[1]);
    const unit = stated[2].toLowerCase();
    const months = unit.startsWith('y') ? amount * 12 : amount;
    if (months > 0 && months <= 120) return months;
  }

  if (!category) return undefined;
  const byCategory: Record<Category, number> = {
    Electronics: 12,
    Appliance: 24,
    Furniture: 24,
    Vehicle: 36,
    Tools: 12,
    // A service's term is always stated on the receipt; 12 is only the
    // fallback for when it is not.
    Service: 12,
    Other: 12,
  };
  return byCategory[category];
}
