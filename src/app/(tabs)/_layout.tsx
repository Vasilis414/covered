import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, type ColorValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { UpsellSheet } from '@/components/upsell-sheet';
import { Spring } from '@/constants/motion';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { useSignInPrompt } from '@/hooks/use-signin-prompt';

/**
 * The JS tab bar, now Android and web only — iOS resolves `_layout.ios.tsx`,
 * which mounts the native UIKit bar for Liquid Glass. The iOS branches below
 * are kept so this file still stands alone if that layout is ever removed.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { prompt, clearPrompt } = useSignInPrompt();

  return (
    <>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        /**
         * On iOS the bar is translucent over a native blur, so content scrolling
         * underneath shows through the way the system's own bars behave.
         * Android keeps the solid chrome colour — its blur is expensive and
         * looks nothing like this.
         */
        tabBarStyle: Platform.select({
          ios: {
            position: 'absolute',
            backgroundColor: 'transparent',
            borderTopColor: theme.separator,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
          default: {
            backgroundColor: theme.chrome,
            borderTopColor: theme.separator,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
        }),
        tabBarBackground:
          Platform.OS === 'ios'
            ? () => (
                <BlurView
                  tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
                  intensity={100}
                  style={StyleSheet.absoluteFill}
                />
              )
            : undefined,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '500' },
      }}>
      <Tabs.Screen
        name="(items)"
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
        name="storage"
        options={{
          title: 'Storage Room',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="archive" size={size} color={color} focused={focused} />
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

    <UpsellSheet reason={prompt} onClose={clearPrompt} />
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
  color: ColorValue;
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
