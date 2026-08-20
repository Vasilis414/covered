import { Ionicons } from '@expo/vector-icons';
import { GlassContainer } from 'expo-glass-effect';
import { useEffect, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { GlassRadius, GlassSpacing, Semantic } from '@/constants/design';
import { GlassCard, glassSupported } from '@/components/ui/glass-card';

/**
 * Groups glass elements so they blend into each other rather than fighting.
 *
 * Wrap grids of tiles, rows of chips and stacks of selectable cards. Without
 * it, adjacent glass surfaces each sample the backdrop independently and the
 * seams between them show.
 */
export function GlassGroup({
  children,
  spacing = 12,
  style,
}: {
  children: ReactNode;
  spacing?: number;
  style?: object;
}) {
  if (!glassSupported) return <View style={style}>{children}</View>;
  return (
    <GlassContainer spacing={spacing} style={style}>
      {children}
    </GlassContainer>
  );
}

/**
 * An SF Symbol, a value, and a caption under it.
 *
 * Values are monospaced so a number changing from 8 to 11 does not shift the
 * chip's width and nudge everything beside it.
 */
export function StatChip({
  icon,
  value,
  label,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  tint?: string;
}) {
  return (
    <GlassCard radius={GlassRadius.pill} tint={tint} style={styles.chip}>
      <View style={styles.chipRow}>
        <Ionicons name={icon} size={13} color={tint ?? '#FFFFFF'} />
        <Text style={styles.chipValue}>{value}</Text>
      </View>
      <Text style={styles.chipLabel}>{label}</Text>
    </GlassCard>
  );
}

/** A vertical icon-over-label tile. One row of these is a screen's actions. */
export function ActionTile({
  icon,
  label,
  tint,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.tileWrap, pressed && styles.tilePressed, disabled && styles.tileDisabled]}>
      <GlassCard radius={GlassRadius.control} tint={tint} interactive style={styles.tile}>
        <Ionicons name={icon} size={24} color={tint ?? '#FFFFFF'} />
        <Text style={styles.tileLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {label}
        </Text>
      </GlassCard>
    </Pressable>
  );
}

/**
 * A dot with a ring that pulses outward.
 *
 * Only animated when the thing it describes is genuinely live. A pulsing dot
 * next to something dormant is a lie the eye believes before the label.
 */
export function PulseDot({ color = Semantic.healthy, live = false }: { color?: string; live?: boolean }) {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!live || reduceMotion) return;
    progress.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, [live, progress, reduceMotion]);

  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 1.6 }],
    opacity: 1 - progress.value,
  }));

  return (
    <View style={styles.dotWrap}>
      {live && !reduceMotion ? (
        <Animated.View style={[styles.ring, { borderColor: color }, ring]} />
      ) : null}
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

/** An optional symbol, a title, and a trailing slot for a control or timestamp. */
export function SectionHeader({
  icon,
  title,
  accessory,
  tint,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  accessory?: ReactNode;
  tint?: string;
}) {
  return (
    <View style={styles.header}>
      {icon ? <Ionicons name={icon} size={16} color={tint ?? 'rgba(255,255,255,0.7)'} /> : null}
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
      {accessory}
    </View>
  );
}

/**
 * Never a bare "no data".
 *
 * A large light symbol, a headline saying what the app is doing, and a caption
 * saying what to do next — an empty screen is the one place a person most needs
 * telling where to go.
 */
export function EmptyState({
  icon,
  headline,
  caption,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  headline: string;
  caption: string;
  tint?: string;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={56} color={tint ?? 'rgba(255,255,255,0.35)'} />
      <Text style={styles.emptyHeadline}>{headline}</Text>
      <Text style={styles.emptyCaption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center' },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  chipLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 1 },

  tileWrap: { flexGrow: 1, flexBasis: 96, minWidth: 96 },
  tilePressed: { opacity: 0.7 },
  tileDisabled: { opacity: 0.4 },
  tile: { height: 76, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 },
  tileLabel: { color: '#FFFFFF', fontSize: 11, fontWeight: '600', textAlign: 'center' },

  dotWrap: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ring: { position: 'absolute', width: 8, height: 8, borderRadius: 4, borderWidth: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    marginBottom: GlassSpacing.withinCard - 4,
  },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  headerSpacer: { flex: 1 },

  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 10 },
  emptyHeadline: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  emptyCaption: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 19,
  },
});

/** Platform note: adjustsFontSizeToFit is iOS-only; Android just clips. */
export const supportsFontScaling = Platform.OS === 'ios';
