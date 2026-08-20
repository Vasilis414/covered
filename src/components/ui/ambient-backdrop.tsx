import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/**
 * The ambient ground every screen floats on.
 *
 * SwiftUI draws this as a 3x3 MeshGradient with one control point drifting
 * horizontally. React Native has no mesh gradient, so this approximates it the
 * way the mesh reads once it is blurred to 40pt anyway: a few large, soft
 * colour fields at low opacity, one of them slowly drifting. At this blur
 * radius the two are hard to tell apart, and this needs no new native
 * dependency.
 *
 * One field is deliberately absent from the lower right — the SwiftUI version
 * keeps a `.clear` cell so the backdrop never reads as a flat wash.
 */
export function AmbientBackdrop({ tint }: { tint: string }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const drift = useSharedValue(0.4);

  useEffect(() => {
    if (reduceMotion) return;
    drift.value = withRepeat(
      withTiming(0.6, { duration: 8000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [drift, reduceMotion]);

  /** The one moving control point, between 0.4 and 0.6 of the width. */
  const drifting = useAnimatedStyle(() => ({
    left: (drift.value - 0.25) * width,
  }));

  const blobSize = Math.max(width, height) * 0.9;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, styles.ground]} />

      {/* Screen tint, top-left — the colour that identifies this section. */}
      <View
        style={[
          styles.blob,
          {
            width: blobSize,
            height: blobSize,
            borderRadius: blobSize / 2,
            backgroundColor: tint,
            opacity: 0.35,
            top: -blobSize * 0.35,
            left: -blobSize * 0.2,
          },
        ]}
      />

      {/* The drifting cell. */}
      <Animated.View
        style={[
          styles.blob,
          {
            width: blobSize * 0.8,
            height: blobSize * 0.8,
            borderRadius: blobSize * 0.4,
            backgroundColor: '#5856D6',
            opacity: 0.28,
            top: height * 0.25,
          },
          drifting,
        ]}
      />

      {/* Purple and blue, mixed under the tint per the palette. */}
      <View
        style={[
          styles.blob,
          {
            width: blobSize * 0.7,
            height: blobSize * 0.7,
            borderRadius: blobSize * 0.35,
            backgroundColor: '#AF52DE',
            opacity: 0.2,
            bottom: -blobSize * 0.2,
            left: -blobSize * 0.15,
          },
        ]}
      />

      {/*
       * A softening veil rather than a blur view.
       *
       * expo-blur samples what is behind it, and stacking one over the whole
       * backdrop on every screen costs real frames on older devices. A
       * translucent dark layer produces the same recessed, hazy ground for
       * free, and the glass cards above supply the actual blur.
       */}
      <View style={[StyleSheet.absoluteFill, styles.veil]} />
    </View>
  );
}

const styles = StyleSheet.create({
  /** Near-black, not pure — pure black flattens the glass edges. */
  ground: { backgroundColor: '#0B0B12' },
  blob: { position: 'absolute' },
  veil: { backgroundColor: 'rgba(11,11,18,0.55)' },
});
