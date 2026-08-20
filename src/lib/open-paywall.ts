import { getOfferings, presentRevenueCatPaywall } from '@/lib/subscriptions';

/**
 * Opens the RevenueCat-hosted paywall, reporting whether the caller needs to
 * fall back to the in-app one.
 *
 * The hosted paywall is preferred because it can be redesigned and A/B tested
 * from the dashboard without shipping an app update. PaywallModal stays as the
 * safety net for when the offering has no paywall attached, or the device is
 * offline — a user who taps Upgrade must always see something.
 */
/**
 * TEMPORARY — set back to false before shipping.
 *
 * Forces the in-app PaywallModal instead of the RevenueCat-hosted paywall, so
 * a review screenshot can be captured while the hosted paywall is still
 * misconfigured. Leaving this true would ship the wrong paywall and make the
 * dashboard-managed one unreachable.
 */
const FORCE_IN_APP_PAYWALL = false;

export async function openPaywall(): Promise<{ purchased: boolean; needsFallback: boolean }> {
  if (FORCE_IN_APP_PAYWALL) return { purchased: false, needsFallback: true };

  /**
   * Ask first, present second.
   *
   * Presenting a paywall that cannot load makes RevenueCat show its own error
   * alert and then leaves the user waiting on the timeout below. Checking for
   * a current offering costs one quiet network call and lets a misconfigured
   * account drop straight to the in-app paywall with no alert and no pause.
   */
  try {
    const offerings = await getOfferings();
    if (!offerings?.current) {
      return { purchased: false, needsFallback: true };
    }
  } catch {
    return { purchased: false, needsFallback: true };
  }

  /**
   * A beat for the calling React Native Modal to finish dismissing.
   *
   * The hosted paywall is a native view controller, and iOS cannot present one
   * over a modal that is still on screen — doing so leaves the sheet half
   * drawn and clipped behind it. Callers close their sheet first; this waits
   * for that dismissal animation before presenting.
   */
  await new Promise((resolve) => setTimeout(resolve, 350));

  /**
   * Waited out, not raced.
   *
   * This used to race presentation against a 6s timeout so a paywall that
   * never appeared could not swallow the tap. But the timeout cannot tell an
   * absent paywall from a user still reading one, and comparing four plans
   * through Face ID and Apple's payment sheet always takes longer than that —
   * so the race fired mid-purchase and stacked the in-app paywall on top of
   * the live one. The offering check above already covers the absent case, and
   * presentRevenueCatPaywall resolves 'unavailable' on its own errors.
   */
  const outcome = await presentRevenueCatPaywall();
  return {
    purchased: outcome === 'purchased',
    // A deliberate dismissal is not a failure; only an absent paywall is.
    needsFallback: outcome === 'unavailable',
  };
}
