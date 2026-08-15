/**
 * Shared motion tokens.
 *
 * Animation reads as quality only when everything moves the same way, so every
 * animated surface in the app pulls its timing from here. The durations are
 * deliberately short: an interface that makes you wait while it admires itself
 * is worse than one that doesn't animate at all.
 */
export const Motion = {
  /** State changes in place — a fade, a colour, a bar filling. */
  quick: 180,
  /** Entrances, and anything travelling a visible distance. */
  standard: 260,
  /** Per-row delay in a staggered list. */
  stagger: 28,
  /**
   * Rows past this position skip the stagger. Without a cap, a library of
   * thirty items would spend a second and a half assembling itself.
   */
  maxStaggered: 8,
} as const;

/** Settles quickly, overshoots barely — the iOS feel rather than a bouncy toy. */
export const Spring = {
  damping: 18,
  stiffness: 220,
  mass: 0.7,
} as const;
