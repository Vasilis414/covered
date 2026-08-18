import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * The Items tab is a stack purely so iOS can draw a real navigation bar:
 * that is what gives us the system large title and, more to the point, the
 * native search field that lives in the bar and collapses as you scroll.
 *
 * Android keeps `LargeTitleScreen` inside the screen and hides this header,
 * so nothing changes there. The other three tabs are untouched.
 */
export default function ItemsStackLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: Platform.OS === 'ios',
        headerLargeTitle: true,
        headerTransparent: true,
        headerTintColor: theme.accent,
        headerLargeTitleShadowVisible: false,
        contentStyle: { backgroundColor: theme.background },
      }}
    />
  );
}
