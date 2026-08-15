import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spring } from '@/constants/motion';
import { ListMetrics, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const TRACK_PADDING = 2;
const SEGMENT_GAP = 2;

/**
 * iOS UISegmentedControl: a filled track with a raised pill on the active
 * segment. The pill is a single view that slides between positions rather than
 * a background that blinks from one segment to the next — that travel is what
 * tells you the two segments are the same control.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);

  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const count = options.length;
  const segmentWidth =
    trackWidth > 0
      ? (trackWidth - TRACK_PADDING * 2 - SEGMENT_GAP * (count - 1)) / count
      : 0;

  const thumbStyle = useAnimatedStyle(() => {
    const x = index * (segmentWidth + SEGMENT_GAP);
    return {
      width: segmentWidth,
      // Before the first layout there is nothing to slide, so snap silently.
      transform: [
        {
          translateX:
            segmentWidth === 0 || reduceMotion ? x : withSpring(x, Spring),
        },
      ],
    };
  });

  function select(next: T) {
    if (next === value) return;
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    onChange(next);
  }

  function measure(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width);
  }

  return (
    <View style={[styles.track, { backgroundColor: theme.fill }]} onLayout={measure}>
      {segmentWidth > 0 ? (
        <Animated.View
          style={[
            styles.thumb,
            thumbStyle,
            {
              pointerEvents: 'none',
              backgroundColor: theme.card,
              // The active segment lifts off the track.
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
            },
          ]}
        />
      ) : null}

      {options.map((option) => (
        <SegmentLabel
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => select(option.value)}
        />
      ))}
    </View>
  );
}

/**
 * The label colour switches outright rather than fading. iOS does the same:
 * the pill's travel is what carries the transition, and a cross-fading label
 * underneath a moving pill just reads as smeared.
 */
function SegmentLabel({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={styles.segment}>
      <ThemedText
        type="footnote"
        numberOfLines={1}
        style={[
          styles.label,
          {
            color: selected ? theme.text : theme.textSecondary,
            fontWeight: selected ? '600' : '400',
          },
        ]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    marginHorizontal: ListMetrics.horizontalInset,
    marginBottom: Spacing.four,
    padding: TRACK_PADDING,
    borderRadius: Radius.sm + 1,
    gap: SEGMENT_GAP,
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    bottom: TRACK_PADDING,
    borderRadius: Radius.sm - 1,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.sm - 1,
  },
  label: { fontSize: 13 },
});
