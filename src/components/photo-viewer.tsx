import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;

/**
 * Full-screen photo viewer with pinch, pan and double-tap zoom.
 *
 * Zoom is the point of it: a receipt is the proof behind a warranty claim, and
 * the small print — serial numbers, dates, terms — is unreadable at thumbnail
 * size or even full-screen-fit on a phone.
 */
export function PhotoViewer({
  uris,
  initialIndex = 0,
  visible,
  onClose,
}: {
  uris: string[];
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
}) {
  const { width, height } = Dimensions.get('window');
  const [index, setIndex] = useState(initialIndex);
  // While a photo is zoomed, horizontal paging must yield to panning.
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
      setZoomed(false);
    }
  }, [visible, initialIndex]);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Same reason as the picker: the modal needs its own inset provider. */}
      <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <ScrollView
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: initialIndex * width, y: 0 }}
          onMomentumScrollEnd={(event) =>
            setIndex(Math.round(event.nativeEvent.contentOffset.x / width))
          }>
          {uris.map((uri) => (
            <ZoomablePhoto
              key={uri}
              uri={uri}
              width={width}
              height={height}
              onZoomChange={setZoomed}
            />
          ))}
        </ScrollView>

        <ViewerChrome index={index} total={uris.length} onClose={onClose} />
      </GestureHandlerRootView>
      </SafeAreaProvider>
    </Modal>
  );
}

/**
 * Rendered inside the modal's own SafeAreaProvider so the hook reads that
 * provider's insets. MIN_TOP is a floor: if a platform ever reports zero the
 * close button still clears the Dynamic Island instead of sitting under it,
 * where taps are swallowed.
 */
function ViewerChrome({
  index,
  total,
  onClose,
}: {
  index: number;
  total: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const MIN_TOP = 44;

  return (
    <View
      style={[styles.chrome, { paddingTop: Math.max(insets.top, MIN_TOP), pointerEvents: 'box-none' }]}>
      <View style={[styles.chromeRow, { pointerEvents: 'box-none' }]}>
        {total > 1 ? (
          <View style={styles.counter}>
            <ThemedText type="footnote" style={styles.chromeText}>
              {index + 1} / {total}
            </ThemedText>
          </View>
        ) : (
          <View />
        )}

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          hitSlop={16}
          style={styles.close}>
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

function ZoomablePhoto({
  uri,
  width,
  height,
  onZoomChange,
}: {
  uri: string;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  function reset() {
    scale.value = withTiming(1);
    savedScale.value = 1;
    x.value = withTiming(0);
    y.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
  }

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(MAX_SCALE, Math.max(0.8, savedScale.value * event.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        x.value = withTiming(0);
        y.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
        runOnJS(onZoomChange)(false);
      } else {
        savedScale.value = scale.value;
        runOnJS(onZoomChange)(true);
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((event) => {
      if (savedScale.value <= 1) return;
      x.value = savedX.value + event.translationX;
      y.value = savedY.value + event.translationY;
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        x.value = withTiming(0);
        y.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
        runOnJS(onZoomChange)(false);
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
        runOnJS(onZoomChange)(true);
      }
    });

  const gesture = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  useEffect(() => reset, []);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width, height }, styles.page, animatedStyle]}>
        <Image source={{ uri }} style={{ width, height }} contentFit="contain" transition={120} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  page: { alignItems: 'center', justifyContent: 'center' },
  chrome: { position: 'absolute', top: 0, left: 0, right: 0 },
  chromeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  counter: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  chromeText: { color: '#FFFFFF' },
  close: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
});
