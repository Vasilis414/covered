/**
 * Design tokens follow Apple's Human Interface Guidelines — system colours,
 * the iOS type scale, and 8pt spacing. Android gets the same values so the two
 * builds stay visually identical rather than half-native on each side.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    /** systemGroupedBackground — the grey behind inset cards. */
    background: '#F2F2F7',
    /** secondarySystemGroupedBackground — the cards themselves. */
    card: '#FFFFFF',
    cardPressed: '#D1D1D6',
    chrome: '#F9F9F9',
    text: '#000000',
    textSecondary: '#8E8E93',
    textTertiary: '#C7C7CC',
    separator: '#C6C6C8',
    fill: '#E9E9EB',
    accent: '#007AFF',
    accentSoft: '#E5F0FF',
    success: '#34C759',
    successSoft: '#E4F8EA',
    warning: '#FF9500',
    warningSoft: '#FFF1E0',
    danger: '#FF3B30',
    dangerSoft: '#FFEAE8',
  },
  dark: {
    background: '#000000',
    card: '#1C1C1E',
    cardPressed: '#2C2C2E',
    chrome: '#1C1C1E',
    text: '#FFFFFF',
    textSecondary: '#8E8E93',
    textTertiary: '#48484A',
    separator: '#38383A',
    fill: '#2C2C2E',
    accent: '#0A84FF',
    accentSoft: '#0B2647',
    success: '#30D158',
    successSoft: '#102C18',
    warning: '#FF9F0A',
    warningSoft: '#31220A',
    danger: '#FF453A',
    dangerSoft: '#33130F',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Selectable tints, drawn from the iOS system colour set. Each carries its own
 * light/dark pair plus the soft wash used behind icons, because a tint that
 * reads well on white is rarely the one that reads well on black.
 */
export const Accents = {
  blue: { light: '#007AFF', dark: '#0A84FF', softLight: '#E5F0FF', softDark: '#0B2647' },
  indigo: { light: '#5856D6', dark: '#5E5CE6', softLight: '#ECECFB', softDark: '#1B1A3D' },
  teal: { light: '#30B0C7', dark: '#64D2FF', softLight: '#E3F6FA', softDark: '#0C2C34' },
  green: { light: '#34C759', dark: '#30D158', softLight: '#E4F8EA', softDark: '#102C18' },
  orange: { light: '#FF9500', dark: '#FF9F0A', softLight: '#FFF1E0', softDark: '#31220A' },
  pink: { light: '#FF2D55', dark: '#FF375F', softLight: '#FFE9EE', softDark: '#360F1A' },
} as const;

export type AccentName = keyof typeof Accents;

export const ACCENT_NAMES = Object.keys(Accents) as AccentName[];

/** What the user picked, before it's resolved against the OS setting. */
export type Appearance = 'system' | 'light' | 'dark';

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  sm: 8,
  /** Matches the corner radius iOS uses for inset grouped list sections. */
  md: 10,
  lg: 16,
  pill: 999,
} as const;

/**
 * One definition for every full-width action button.
 *
 * GlassButton sized itself and Apple's AppleAuthenticationButton sized itself,
 * so a 50pt/16pt-radius button sat next to a 48pt one whose radius Apple
 * clamped from the 999 it was handed — visibly mismatched in height and
 * corner. Apple's control cannot be styled by stylesheet, only by these two
 * props, so both must read the same numbers.
 */
export const ButtonMetrics = {
  height: 50,
  radius: Radius.lg,
} as const;

/** Standard iOS list metrics — rows are 44pt minimum, separators inset past the icon. */
export const ListMetrics = {
  rowHeight: 44,
  horizontalInset: Spacing.three,
  separatorInset: 60,
} as const;

export const MaxContentWidth = 800;
