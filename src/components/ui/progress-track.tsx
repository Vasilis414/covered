import { useEffect } from 'react';
import { StyleSheet, View, type ColorValue, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Motion } from '@/constants/motion';
import { Radius } from '@/constants/theme';

/**
 * How much of the cover has been used up, drawn as a bar that fills on arrival.
 *
 * The fill is a full-width view scaled along X rather than a percentage width,
 * so the whole animation runs on the UI thread and never touches layout.
 */
export function ProgressTrack({
  progress,
  color,
  trackColor,
  style,
}: {
  /** 0–1. Values outside are clamped by the caller. */
  progress: number;
  color: ColorValue;
  trackColor: ColorValue;
  style?: ViewStyle;
}) {
  const reduceMotion = useReducedMotion();
  const value = useSharedValue(reduceMotion ? progress : 0);

  useEffect(() => {
    value.value = reduceMotion
      ? progress
      : withTiming(progress, { duration: Motion.standard * 2 });
  }, [progress, reduceMotion, value]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: value.value }],
  }));

  return (
    <View style={[styles.track, { backgroundColor: trackColor }, style]}>
      <Animated.View
        style={[styles.fill, { backgroundColor: color }, fillStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: Radius.pill,
    // Grows rightwards from the start of the track, not outwards from the middle.
    transformOrigin: 'left center',
  },
});
