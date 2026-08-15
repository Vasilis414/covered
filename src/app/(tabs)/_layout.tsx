import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { UpsellSheet, type UpsellReason } from '@/components/upsell-sheet';
import { Spring } from '@/constants/motion';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/store/auth';

export default function TabsLayout() {
  const theme = useTheme();
  const { ready, signedIn } = useAuth();
  const [prompt, setPrompt] = useState<UpsellReason>(null);
  /**
   * A ref, not state, and deliberately so: this guard is written from inside
   * the effect below. As state it was also a dependency, so setting it
   * re-ran the effect, and the re-run's cleanup cleared the pending timer
   * before it could fire — the prompt never appeared at all.
   */
  const asked = useRef(false);

  /**
   * Ask on launch rather than mid-task.
   *
   * This used to appear right after a photo was attached, which interrupted
   * the scan that was already running. Opening the app is a moment with
   * nothing in flight.
   */
  useEffect(() => {
    if (!ready || signedIn || asked.current) return;
    asked.current = true;
    const timer = setTimeout(() => setPrompt('signin'), 600);
    return () => clearTimeout(timer);
  }, [ready, signedIn]);

  return (
    <>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.chrome,
          borderTopColor: theme.separator,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '500' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Items',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="albums" size={size} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="upcoming"
        options={{
          title: 'Upcoming',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="alarm" size={size} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="settings" size={size} color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>

    <UpsellSheet reason={prompt} onClose={() => setPrompt(null)} />
    </>
  );
}

/**
 * The selected tab's glyph gives a single quick pop.
 *
 * It fires only on the transition into focus, so returning to a tab you are
 * already on stays still — an icon that jumps every time you touch it starts
 * to feel like a fault rather than feedback.
 */
function TabIcon({
  name,
  size,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  size: number;
  color: string;
  focused: boolean;
}) {
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!focused || reduceMotion) return;
    scale.value = withSequence(withTiming(1.18, { duration: 110 }), withSpring(1, Spring));
  }, [focused, reduceMotion, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
}
