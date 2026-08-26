import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Says which image is being read, not merely that something is happening.
 *
 * A spinner in a row below the strip leaves the question open when several
 * attachments are present. Putting the sweep on the thumbnail itself answers
 * it: this one, right now.
 *
 * The bar sweeps top to bottom over 1.4s, the way a scanner passes over a
 * page. It is the only place in the app that animates continuously, and it
 * stops the moment the read finishes — a sweep over a photo nothing is reading
 * would be a lie the eye believes before the caption.
 */
export function ScanningOverlay() {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [progress, reduceMotion]);

  const sweep = useAnimatedStyle(() => ({
    // 76pt tile, less the bar's own height.
    top: progress.value * 68,
  }));

  return (
    <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="none">
      {reduceMotion ? (
        <View style={styles.center}>
          <Ionicons name="sparkles" size={20} color="#FFFFFF" />
        </View>
      ) : (
        <Animated.View style={[styles.bar, { backgroundColor: theme.accent }, sweep]} />
      )}
    </View>
  );
}

/**
 * The caption that accompanies the sweep.
 *
 * Separate from the overlay so it can sit under the strip at full width rather
 * than being squeezed into a 76pt tile.
 */
export function ScanningCaption({ label = 'Reading the receipt…' }: { label?: string }) {
  const theme = useTheme();

  return (
    <View style={styles.caption}>
      <Ionicons name="sparkles" size={15} color={theme.accent} />
      <ThemedText type="footnote" style={{ color: theme.accent, fontWeight: '600' }}>
        {label}
      </ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary">
        a few seconds
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 8,
    opacity: 0.9,
  },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
