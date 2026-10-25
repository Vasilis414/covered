import { Platform } from 'react-native';
import Purchases, {
  CustomerInfo,
  LOG_LEVEL,
  PurchasesOfferings,
  PurchasesPackage,
} from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

/**
 * Public SDK keys, one per store. A `test_` key cannot be used here:
 * RevenueCat deliberately calls fatalError in Release builds to stop a Test
 * Store key ever reaching the App Store.
 */
const REVENUECAT_APPLE_KEY = 'appl_fRLuSpvTndPuuvpdauZkvoHuNSw';
const REVENUECAT_GOOGLE_KEY = 'goog_bWTSjhKxJMpImlZhyPtuBJXsQZl';
export const REVENUECAT_API_KEY =
  Platform.OS === 'android' ? REVENUECAT_GOOGLE_KEY : REVENUECAT_APPLE_KEY;
/** Must match the entitlement identifier in the RevenueCat dashboard exactly. */
export const PRO_ENTITLEMENT_ID = 'Covered';

export const PRODUCT_IDS = {
  monthly: 'monthly',
  threeMonth: 'three_month',
  sixMonth: 'six_month',
  yearly: 'yearly',
} as const;

export type PlanTier = keyof typeof PRODUCT_IDS;

export const DEFAULT_PRICES: Record<PlanTier, { title: string; price: string; period: string; badge?: string }> = {
  monthly: { title: 'Monthly', price: '€1.99', period: '/ month' },
  threeMonth: { title: '3 Months', price: '€2.99', period: '/ 3 months', badge: 'Popular' },
  sixMonth: { title: '6 Months', price: '€4.99', period: '/ 6 months', badge: 'Save 40%' },
  yearly: { title: '1 Year', price: '€7.99', period: '/ year', badge: 'Best Value' },
};

let isConfigured = false;

/**
 * Initializes RevenueCat SDK with the provided API key and sets up debug logging.
 */
export function configureRevenueCat(): void {
  if (isConfigured || Platform.OS === 'web') return;

  /**
   * Quiet in release, verbose while developing.
   *
   * A shipped build should not be writing purchase detail into device logs, so
   * only debug builds get the full trace. Pin this to VERBOSE temporarily if a
   * StoreKit error ever needs its underlying cause read on a real device — the
   * wrapper messages alone are not enough to diagnose one.
   */
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
  try {
    Purchases.configure({
      apiKey: REVENUECAT_API_KEY,
    });
    isConfigured = true;
  } catch (error) {
    console.warn('[RevenueCat] Configure failed:', error);
  }
}

/**
 * Checks whether the user has the active Pro entitlement.
 */
export async function checkProEntitlement(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo.entitlements.active[PRO_ENTITLEMENT_ID] !== undefined;
  } catch (error) {
    console.warn('[RevenueCat] Failed to fetch customer info:', error);
    return false;
  }
}

/**
 * Retrieves the current customer info.
 */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (error) {
    console.warn('[RevenueCat] Error getting customer info:', error);
    return null;
  }
}

/**
 * Retrieves available offerings and packages.
 */
export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await Purchases.getOfferings();
  } catch (error) {
    console.warn('[RevenueCat] Failed to fetch offerings:', error);
    return null;
  }
}

/**
 * Purchases a product by ID or Package identifier.
 */
export async function purchaseProductById(tierKey: PlanTier): Promise<{
  success: boolean;
  customerInfo?: CustomerInfo;
  userCancelled?: boolean;
}> {
  if (Platform.OS === 'web') return { success: false };
  const productId = PRODUCT_IDS[tierKey] || tierKey;

  try {
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages.find(
      (p) => p.product.identifier === productId || p.identifier === productId || p.packageType?.toLowerCase() === tierKey.toLowerCase()
    );

    if (pkg) {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const hasPro = customerInfo.entitlements.active[PRO_ENTITLEMENT_ID] !== undefined;
      return { success: hasPro, customerInfo, userCancelled: false };
    }

    const products = await Purchases.getProducts([productId]);
    if (products.length > 0) {
      const { customerInfo } = await Purchases.purchaseStoreProduct(products[0]);
      const hasPro = customerInfo.entitlements.active[PRO_ENTITLEMENT_ID] !== undefined;
      return { success: hasPro, customerInfo, userCancelled: false };
    }

    return { success: false, userCancelled: false };
  } catch (error: any) {
    if (error.userCancelled) {
      return { success: false, userCancelled: true };
    }
    console.warn('[RevenueCat] Purchase error:', error);
    return { success: false, userCancelled: false };
  }
}

/**
 * Restores previous purchases.
 */
export async function restorePurchases(): Promise<{
  success: boolean;
  customerInfo?: CustomerInfo;
}> {
  if (Platform.OS === 'web') return { success: false };
  try {
    const customerInfo = await Purchases.restorePurchases();
    const hasPro = customerInfo.entitlements.active[PRO_ENTITLEMENT_ID] !== undefined;
    return { success: hasPro, customerInfo };
  } catch (error) {
    console.warn('[RevenueCat] Restore failed:', error);
    return { success: false };
  }
}

/**
 * Presents the native RevenueCat Paywall UI.
 */
/**
 * Outcome of showing the RevenueCat-hosted paywall.
 *
 * `unavailable` is kept apart from `cancelled` on purpose: only the former
 * should fall back to the in-app paywall. Treating a deliberate dismissal as
 * a failure would pop a second paywall the instant the user closed the first.
 */
export type PaywallOutcome = 'purchased' | 'cancelled' | 'unavailable';

export async function presentRevenueCatPaywall(): Promise<PaywallOutcome> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const result = await RevenueCatUI.presentPaywall();
    switch (result) {
      case PAYWALL_RESULT.PURCHASED:
      case PAYWALL_RESULT.RESTORED:
        return 'purchased';
      case PAYWALL_RESULT.CANCELLED:
        return 'cancelled';
      case PAYWALL_RESULT.NOT_PRESENTED:
      case PAYWALL_RESULT.ERROR:
      default:
        return 'unavailable';
    }
  } catch (error) {
    console.warn('[RevenueCat] Paywall presentation failed:', error);
    return 'unavailable';
  }
}

/**
 * Presents the native RevenueCat Customer Center UI.
 */
export async function presentCustomerCenter(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (typeof RevenueCatUI.presentCustomerCenter === 'function') {
      await RevenueCatUI.presentCustomerCenter();
    }
  } catch (error) {
    console.warn('[RevenueCat] Customer Center presentation failed:', error);
  }
}

/**
 * The real, localised price string for each tier, straight from the store.
 *
 * DEFAULT_PRICES is only a placeholder for the instant before offerings
 * load. Shipping hardcoded prices is wrong twice over: they drift the
 * moment prices change in App Store Connect, and they show euros to
 * someone paying in dollars.
 */
export async function fetchLivePrices(): Promise<Partial<Record<PlanTier, string>>> {
  if (Platform.OS === 'web') return {};
  try {
    const offerings = await Purchases.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    const prices: Partial<Record<PlanTier, string>> = {};

    for (const tier of Object.keys(PRODUCT_IDS) as PlanTier[]) {
      const productId = PRODUCT_IDS[tier];
      const match = packages.find((pkg: PurchasesPackage) => pkg.product.identifier === productId);
      if (match) prices[tier] = match.product.priceString;
    }
    return prices;
  } catch (error) {
    console.warn('[RevenueCat] Could not read live prices:', error);
    return {};
  }
}

/**
 * Binds purchases to an account instead of the handset.
 *
 * Without this the SDK stays on the anonymous id it generates per install, so
 * a subscription bought by one person was reported as active for whoever
 * signed in on that phone next. Calling this on sign-in moves the purchase to
 * the account that made it; RevenueCat merges any anonymous purchase into that
 * account the first time, which is what makes a fresh buy stick to its buyer.
 */
/**
 * Re-reads the store receipt and attaches it to the current app user id.
 *
 * logIn alone does not do this: the SDK keeps serving whatever CustomerInfo it
 * had cached, so signing into a second account showed no purchase until the
 * next cold start — which is why a subscription already tied to another
 * account only got flagged after restarting the app. Syncing makes the check
 * happen at the moment of the switch.
 */
export async function syncStorePurchases(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Purchases.syncPurchases();
  } catch (error) {
    console.warn('[RevenueCat] syncPurchases failed:', error);
  }
}

export async function identifyUser(userId: string): Promise<void> {
  if (Platform.OS === 'web' || !userId) return;
  try {
    await Purchases.logIn(userId);
  } catch (error) {
    console.warn('[RevenueCat] logIn failed:', error);
  }
}

/**
 * Returns the SDK to a fresh anonymous id at sign-out.
 *
 * Skipping this leaves the previous account's CustomerInfo cached, so the next
 * person to sign in on the same phone inherits their Pro access.
 */
export async function forgetUser(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Purchases.logOut();
  } catch (error) {
    // Already anonymous is not a failure worth surfacing.
    console.warn('[RevenueCat] logOut skipped:', error);
  }
}
