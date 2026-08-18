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
  const { accent } = useSettings();

  return useMemo(() => {
    const tint = Accents[accent] ?? Accents.blue;
    const hex = Colors[scheme];
    const ios = Platform.OS === 'ios';
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
  }, [scheme, accent]);
}
