/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Color } from 'expo-router';
import { useMemo } from 'react';
import { Platform, type ColorValue } from 'react-native';

import { Accents, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSettings } from '@/store/settings';

/**
 * The scheme actually in force: the user's explicit choice, or the OS setting
 * when they've left it on System. React Native reports null when the platform
 * has no preference, which we treat as light.
 */
export function useResolvedScheme(): 'light' | 'dark' {
  const system = useColorScheme();
  const { appearance } = useSettings();

  if (appearance === 'light' || appearance === 'dark') return appearance;
  return system === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  const scheme = useResolvedScheme();
  const system = useColorScheme();
  const { accent } = useSettings();

  return useMemo(() => {
    const tint = Accents[accent] ?? Accents.blue;
    const hex = Colors[scheme];
    /**
     * The iOS semantic colours only apply while the app agrees with the OS.
     *
     * `Color.ios.*` are dynamic colours: UIKit resolves them from the device's
     * appearance when they are drawn, ignoring `scheme` entirely. Applying them
     * to someone who has overridden Appearance in Settings repainted the whole
     * app in the OS's scheme instead of their choice, which read as the Light
     * setting doing nothing on a dark phone. When the two disagree we fall back
     * to the static palette, which honours the override.
     */
    const ios = Platform.OS === 'ios' && scheme === (system === 'dark' ? 'dark' : 'light');
    return {
      ...hex,
      ...(ios
        ? {
            background: Color.ios.systemGroupedBackground,
            card: Color.ios.secondarySystemGroupedBackground,
            cardPressed: Color.ios.tertiarySystemGroupedBackground,
            chrome: Color.ios.systemBackground,
            text: Color.ios.label,
            textSecondary: Color.ios.secondaryLabel,
            textTertiary: Color.ios.tertiaryLabel,
            separator: Color.ios.separator,
            fill: Color.ios.tertiarySystemFill,
            success: Color.ios.systemGreen,
            warning: Color.ios.systemOrange,
            danger: Color.ios.systemRed,
          }
        : {}),
      accent: (scheme === 'dark' ? tint.dark : tint.light) as ColorValue,
      accentSoft: (scheme === 'dark' ? tint.softDark : tint.softLight) as ColorValue,
    };
  }, [scheme, system, accent]);
}
