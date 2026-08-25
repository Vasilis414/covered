/**
 * The Plenum design language: Liquid Glass on an ambient backdrop.
 *
 * Shared across Plenum's iOS apps. The original is SwiftUI on iOS 26; this is
 * the React Native translation, and the mapping is close because SDK 57 exposes
 * the same UIKit glass primitives through expo-glass-effect. Where SwiftUI has
 * no RN counterpart — MeshGradient, symbolEffect — the note on the constant
 * says what is being approximated and how.
 */

/**
 * Radii carry meaning: the bigger the surface, the softer the corner. Nesting a
 * 26 inside a 26 makes both look wrong, so each level down steps in.
 * Do not add values here — if something needs a new radius, it is the wrong size.
 */
export const GlassRadius = {
  /** Cards floating on the backdrop. */
  card: 26,
  /** Selectable rows — plan pickers, destination choosers. */
  selectable: 24,
  /** Rows inside a list. */
  row: 20,
  /** Embedded media: receipt thumbnails, PDF previews. */
  media: 18,
  /** Controls sitting inside a card. */
  control: 16,
  /** Controls nested one level deeper still. */
  nested: 14,
  /** Chips and pills. */
  pill: 999,
} as const;

/**
 * Assigned round-robin so an entity keeps the same colour every launch.
 *
 * Stable identity is the point: a warranty that was cyan yesterday is cyan
 * today, which is what lets someone find it by colour before reading it.
 */
export const AccentPalette = [
  '#32ADE6', // cyan
  '#AF52DE', // purple
  '#FF9500', // orange
  '#00C7BE', // mint
  '#FF2D55', // pink
  '#5856D6', // indigo
  '#30B0C7', // teal
  '#FFCC00', // yellow
] as const;

/** Stable per-entity colour. Same id in, same colour out. */
export function accentFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AccentPalette[Math.abs(hash) % AccentPalette.length];
}

/**
 * Never decorative. If something is red, it is genuinely wrong — a warranty
 * that has already expired, a backup that failed. Orange is "needs attention
 * soon", which for this app means cover ending within the month.
 */
export const Semantic = {
  healthy: '#30D158',
  attention: '#FF9F0A',
  failure: '#FF453A',
  unknown: '#8E8E93',
} as const;

/** Each screen passes its own tint so sections feel distinct. */
export const ScreenTint = {
  warranties: '#32ADE6',
  upcoming: '#FF9F0A',
  storage: '#5856D6',
  settings: '#00C7BE',
  actions: '#AF52DE',
} as const;

export const GlassSpacing = {
  /** Screen edge padding. */
  screen: 16,
  /** Between cards. */
  betweenCards: 16,
  /** Within a card. */
  withinCard: 12,
  /** Card internal padding. */
  cardPadding: 16,
  /**
   * Bottom padding on scroll views, so the last card clears the floating tab
   * bar instead of hiding behind it.
   */
  scrollBottom: 80,
} as const;

/**
 * Appearance is the user's choice again.
 *
 * The glass materials were tuned against a dark ground, so Light was pinned off
 * rather than shipped looking wrong — but Settings kept offering the choice,
 * which made the setting look broken instead of absent. AmbientBackdrop now
 * draws a light ground and veil to match, so the glass has something to sample
 * either way and the control does what it says.
 */
export const FORCE_DARK = false;
