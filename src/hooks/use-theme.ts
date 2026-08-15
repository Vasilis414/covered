/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useMemo } from 'react';

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
    return {
      ...Colors[scheme],
      accent: scheme === 'dark' ? tint.dark : tint.light,
      accentSoft: scheme === 'dark' ? tint.softDark : tint.softLight,
    };
  }, [scheme, accent]);
}
