import * as Haptics from 'expo-haptics';
import { type ReactNode } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Spring } from '@/constants/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A pressable that dips under your thumb.
 *
 * Reserved for buttons — things that look raised and act once. List rows use a
 * background highlight instead, because a row that shrinks reads as a card you
 * could drag rather than a line you can tap.
 */
export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  ...rest
}: PressableProps & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far it dips. Larger controls need less travel to read as pressed. */
  scaleTo?: number;
}) {
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : withSpring(scale.value, Spring) }],
  }));

  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = scaleTo;
        if (Platform.OS === 'ios' && !reduceMotion) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }}
      onPressOut={() => {
        scale.value = 1;
      }}
      style={[style, animatedStyle]}
      {...rest}>
      {children}
    </AnimatedPressable>
  );
}
