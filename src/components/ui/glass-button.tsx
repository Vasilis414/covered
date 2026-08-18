import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { type ReactNode } from 'react';
import { Platform, StyleSheet, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
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
    <ThemedText type="headline" style={{ color: glass ? theme.text : '#FFFFFF' }}>
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
        style={[styles.frame, style, { opacity: disabled ? 0.55 : 1 }]}>
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
    height: 50,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glass: {
    ...StyleSheet.absoluteFill,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
