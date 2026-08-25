import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { type ReactNode } from 'react';
import { Platform, StyleSheet, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { ButtonMetrics, Radius } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';

function canUseGlass(): boolean {
  return (
    Platform.OS === 'ios' &&
    isLiquidGlassAvailable() &&
    isGlassEffectAPIAvailable()
  );
}

/**
 * Primary action. On iOS 26 it is real liquid glass, tinted with the user's
 * accent; everywhere else it is the same filled pill we already shipped.
 */
export function GlassButton({
  label,
  onPress,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const glass = canUseGlass();

  const inner: ReactNode = (
    <ThemedText type="headline" style={{ color: '#FFFFFF' }}>
      {label}
    </ThemedText>
  );

  if (glass) {
    return (
      <PressableScale
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        scaleTo={0.97}
        /**
         * The accent fill sits underneath the glass rather than only inside its
         * tint. `GlassView` renders clear whenever the system declines the
         * effect — reduced transparency, low power, a stale layer after a theme
         * change — and the button was then an invisible label on the
         * background. With the fill behind it, glass tints the accent when it
         * works and the plain pill shows through when it doesn't.
         */
        style={[
          styles.frame,
          { backgroundColor: theme.accent },
          style,
          { opacity: disabled ? 0.55 : 1 },
        ]}>
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          tintColor={String(theme.accent)}
          colorScheme={scheme}
          style={styles.glass}>
          {inner}
        </GlassView>
      </PressableScale>
    );
  }

  return (
    <PressableScale
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.frame, { backgroundColor: theme.accent, opacity: disabled ? 0.55 : 1 }, style]}>
      {inner}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'stretch',
    height: ButtonMetrics.height,
    borderRadius: ButtonMetrics.radius,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glass: {
    ...StyleSheet.absoluteFill,
    borderRadius: ButtonMetrics.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
