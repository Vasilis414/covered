import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Platform, ScrollView, StyleSheet, View, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const WHEEL_ITEM_HEIGHT = 40;
const VISIBLE_ROWS = 5;
export const WHEEL_HEIGHT = WHEEL_ITEM_HEIGHT * VISIBLE_ROWS;

/**
 * A snapping scroll wheel.
 *
 * Built rather than taken from a library because the platform pickers diverge:
 * iOS renders a wheel, Android a dropdown. This behaves identically on both,
 * which matters when the whole control is two wheels side by side.
 */
export function WheelPicker<T extends string | number>(props: {
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format?: (value: T) => string;
  width?: number;
}) {
  /**
   * The hand-built wheel on every platform, including iOS.
   *
   * `@expo/ui`'s Picker looked like the right call — the real UIPickerView —
   * but in SDK 57 it ignored `selectedValue` (a sheet defaulting to 30 opened
   * showing 1) and swallowed drags without ever calling `onValueChange`, so a
   * custom cover length could not be set at all. It also handed numeric values
   * back as strings, which turned "31 days" into years downstream. This wheel
   * is plain React Native and behaves the same on both platforms.
   */
  return <FallbackWheel {...props} />;
}

function FallbackWheel<T extends string | number>({
  values,
  value,
  onChange,
  format,
  width,
}: {
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format?: (value: T) => string;
  width?: number;
}) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const lastIndex = useRef(values.indexOf(value));

  // Keep the wheel aligned when the value changes from outside.
  useEffect(() => {
    const index = values.indexOf(value);
    if (index < 0 || index === lastIndex.current) return;
    lastIndex.current = index;
    scrollRef.current?.scrollTo({ y: index * WHEEL_ITEM_HEIGHT, animated: true });
  }, [value, values]);

  function settle(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(values.length - 1, index));
    if (clamped === lastIndex.current) return;
    lastIndex.current = clamped;
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    onChange(values[clamped]);
  }

  return (
    <View style={[styles.wheel, width ? { width } : styles.flex]}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: Math.max(0, values.indexOf(value)) * WHEEL_ITEM_HEIGHT }}
        // Half a wheel of padding top and bottom puts the first and last values
        // in the centre band rather than stranding them at the edges.
        contentContainerStyle={{ paddingVertical: (WHEEL_HEIGHT - WHEEL_ITEM_HEIGHT) / 2 }}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}>
        {values.map((entry) => {
          const selected = entry === value;
          return (
            <View key={String(entry)} style={styles.row}>
              <ThemedText
                type={selected ? 'headline' : 'body'}
                style={{ color: selected ? theme.text : theme.textSecondary }}>
                {format ? format(entry) : String(entry)}
              </ThemedText>
            </View>
          );
        })}
      </ScrollView>

      {/* Selection band, drawn behind the text and ignoring touches. */}
      <View
        style={[
          styles.band,
          { backgroundColor: theme.fill, pointerEvents: 'none' },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wheel: { height: WHEEL_HEIGHT, justifyContent: 'center' },
  row: { height: WHEEL_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  band: {
    position: 'absolute',
    left: Spacing.one,
    right: Spacing.one,
    top: (WHEEL_HEIGHT - WHEEL_ITEM_HEIGHT) / 2,
    height: WHEEL_ITEM_HEIGHT,
    borderRadius: Radius.sm,
    zIndex: -1,
  },
});
