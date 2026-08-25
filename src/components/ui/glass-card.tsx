import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { GlassRadius, GlassSpacing } from '@/constants/design';
import { useResolvedScheme } from '@/hooks/use-theme';

/**
 * Liquid Glass needs iOS 26 and a device that supports it.
 *
 * Everything else — older iOS, Android, the simulator on some hosts — gets a
 * translucent card instead. Deliberately not a hard requirement: a screen that
 * renders nothing on Android is worse than one that renders a plain card.
 */
export const glassSupported =
  Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export function GlassCard({
  children,
  tint,
  interactive = false,
  radius = GlassRadius.card,
  style,
}: {
  children: ReactNode;
  /**
   * Tinted only when the card represents something with a state or identity —
   * a warranty's colour, a status. An untinted card is the default; tinting
   * everything removes the meaning from the ones that need it.
   */
  tint?: string;
  interactive?: boolean;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  // Follows the chosen appearance rather than a pinned 'dark' — the card kept
  // sampling as if the ground were black once Light became selectable.
  const scheme = useResolvedScheme();

  if (!glassSupported) {
    return (
      <View style={[styles.fallback, { borderRadius: radius }, style]}>
        {tint ? (
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.16, borderRadius: radius }]}
            pointerEvents="none"
          />
        ) : null}
        {children}
      </View>
    );
  }

  return (
    <GlassView
      glassEffectStyle="regular"
      // 0.35 is the shipped value; lower and the identity is invisible against
      // the backdrop, higher and the card stops reading as glass.
      tintColor={tint ? `${tint}59` : undefined}
      isInteractive={interactive}
      colorScheme={scheme}
      style={[styles.card, { borderRadius: radius }, style]}>
      {children}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: GlassSpacing.cardPadding,
    overflow: 'hidden',
  },
  fallback: {
    padding: GlassSpacing.cardPadding,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
});
