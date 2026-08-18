import { Ionicons } from '@expo/vector-icons';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';

/**
 * Same gate as `glass-button.tsx`: liquid glass only exists on iOS 26, and
 * only when the effect API is actually present.
 */
export function canUseGlass(): boolean {
  return Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
}

/**
 * The bar that `item/[id]`, `storage/[id]`, `add` and `storage-add` each used
 * to hand-roll. They had drifted — different min-widths, one with a chrome
 * background and one without — so this is one shape with slots.
 */
export function ScreenBar({
  title,
  left,
  right,
  filled,
}: {
  title?: string;
  left?: ReactNode;
  right?: ReactNode;
  /** Modals sit on their own chrome colour; detail screens sit on the background. */
  filled?: boolean;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.bar,
        { borderBottomColor: theme.separator },
        filled ? { backgroundColor: theme.chrome } : null,
      ]}>
      <View style={styles.side}>{left}</View>
      {title ? (
        <ThemedText type="headline" numberOfLines={1} style={styles.title}>
          {title}
        </ThemedText>
      ) : (
        <View style={styles.title} />
      )}
      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

/**
 * On iOS 26 this is the system idiom: a glass circle holding just the
 * chevron. Elsewhere it stays the chevron-plus-"Back" pair we shipped, since
 * a bare glyph with no material behind it reads as unfinished.
 */
export function BackButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const scheme = useResolvedScheme();

  if (canUseGlass()) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={12}>
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          colorScheme={scheme}
          style={styles.circle}>
          <SymbolView name="chevron.backward" size={17} tintColor={String(theme.accent)} />
        </GlassView>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={12}
      style={styles.backRow}>
      <Ionicons name="chevron-back" size={24} color={theme.accent} />
      <ThemedText style={{ color: theme.accent, fontSize: 16 }}>Back</ThemedText>
    </Pressable>
  );
}

/**
 * The trailing share / trash / edit glyphs. Same treatment as the back
 * button so a bar never mixes a glass circle with a bare icon.
 */
export function BarIconButton({
  symbol,
  ionicon,
  label,
  color,
  onPress,
}: {
  symbol: SFSymbol;
  ionicon: keyof typeof Ionicons.glyphMap;
  label: string;
  color?: ColorValue;
  onPress: () => void;
}) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const tint = color ?? theme.accent;

  if (canUseGlass()) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={12}>
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          colorScheme={scheme}
          style={styles.circle}>
          <SymbolView name={symbol} size={17} tintColor={String(tint)} />
        </GlassView>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={12}>
      <Ionicons name={ionicon} size={20} color={tint} />
    </Pressable>
  );
}

/** A plain text action — "Cancel", "Save", "Edit". */
export function BarTextButton({
  label,
  onPress,
  disabled,
  prominent,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  prominent?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" hitSlop={12}>
      <ThemedText
        type={prominent ? 'headline' : 'body'}
        style={{ color: disabled ? theme.textTertiary : theme.accent }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { minWidth: 74, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sideRight: { justifyContent: 'flex-end' },
  title: { flex: 1, textAlign: 'center', marginHorizontal: Spacing.two },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  circle: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
