import { useEffect, type ReactNode } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const PERIOD = 900;
const DIM = 0.55;

/**
 * A slow opacity pulse, for something the app is busy doing.
 *
 * A spinner says "wait"; this says "still working" without adding a second
 * moving part next to one. Held at full opacity when the system asks for
 * reduced motion, since a pulse is exactly the kind of thing that setting is
 * meant to stop.
 */
export function Breathing({ children }: { children: ReactNode }) {
  const value = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      value.value = 1;
      return;
    }
    value.value = withRepeat(
      withTiming(DIM, { duration: PERIOD, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [reduceMotion, value]);

  const style = useAnimatedStyle(() => ({ opacity: value.value }));

  return <Animated.View style={style}>{children}</Animated.View>;
}
