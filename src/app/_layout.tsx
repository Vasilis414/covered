import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { AuthProvider } from '@/store/auth';
import { BackupProvider } from '@/store/backup';
import { ItemsProvider, useItems } from '@/store/items';
import { SettingsProvider } from '@/store/settings';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { ready } = useItems();
  const scheme = useResolvedScheme();
  const theme = useTheme();

  useEffect(() => {
    // Hold the splash until the library is loaded, so no screen flashes empty.
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          headerTintColor: theme.accent,
          headerTitleStyle: { color: theme.text },
          headerStyle: { backgroundColor: theme.chrome },
          contentStyle: { backgroundColor: theme.background },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="item/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
      </Stack>
      {/* Follows the in-app theme, not the OS, so an override looks right. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SettingsProvider>
        <AuthProvider>
          <ItemsProvider>
            <BackupProvider>
              <RootNavigator />
            </BackupProvider>
          </ItemsProvider>
        </AuthProvider>
      </SettingsProvider>
    </GestureHandlerRootView>
  );
}
