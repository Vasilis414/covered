import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ShareIntentSheet } from '@/components/share-intent-sheet';
import { AmbientBackdrop } from '@/components/ui/ambient-backdrop';
import { ScreenTint } from '@/constants/design';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { AuthProvider } from '@/store/auth';
import { BackupProvider } from '@/store/backup';
import { ItemsProvider, useItems } from '@/store/items';
import { SettingsProvider } from '@/store/settings';
import { StorageProvider, useStorage } from '@/store/storage';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { ready: itemsReady } = useItems();
  const { ready: storageReady } = useStorage();
  const ready = itemsReady && storageReady;
  const scheme = useResolvedScheme();
  const theme = useTheme();

  useEffect(() => {
    // Hold the splash until the library is loaded, so no screen flashes empty.
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/*
        The ambient ground, drawn once behind the whole navigator.
        Screens are transparent so it shows through and stays continuous across
        a push — drawing it per screen made it restart on every navigation.
      */}
      <AmbientBackdrop tint={ScreenTint.warranties} />
      <Stack
        screenOptions={{
          headerTintColor: theme.accent,
          headerTitleStyle: { color: theme.text },
          /**
           * Solid, not transparent.
           *
           * A transparent header sits over the ambient backdrop and picks up
           * whichever colour field happens to be behind it — which read as a
           * muddy teal bar above every modal, in both appearances. The bar is
           * chrome rather than content, so it takes a flat ground: white in
           * Light, black in Dark.
           */
          headerStyle: { backgroundColor: scheme === 'dark' ? '#000000' : '#FFFFFF' },
          /**
           * Deliberately not headerTransparent.
           *
           * That option lays content out underneath the header, and
           * react-navigation then reports a top inset that already includes
           * the header height. LargeTitleScreen adds NAV_BAR_HEIGHT to
           * insets.top itself, so every screen using it gained a second
           * header's worth of empty space. A transparent background alone
           * lets the backdrop through without touching the inset maths.
           */
          contentStyle: { backgroundColor: 'transparent' },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* These two set headerShown themselves: iOS uses the native modal bar,
            Android keeps the in-flow ScreenBar. */}
        <Stack.Screen name="add" options={{ presentation: 'modal', headerShown: Platform.OS === 'ios' }} />
        <Stack.Screen
          name="storage-add"
          options={{ presentation: 'modal', headerShown: Platform.OS === 'ios' }}
        />
        {/* Draws its own back bar, like storage/[id] — see the note there. */}
        <Stack.Screen name="item/[id]" options={{ headerShown: false }} />
        {/*
          storage/[id] draws its own back bar, the same way the modals do.
          Unregistered, the Stack fell back to defaults and stacked a second
          header above it titled with the raw route name.
        */}
        <Stack.Screen name="storage/[id]" options={{ headerShown: false }} />
      </Stack>
      {/* Sits above the Stack: a shared file can arrive on any screen. */}
      <ShareIntentSheet />

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
            <StorageProvider>
              <BackupProvider>
                <RootNavigator />
              </BackupProvider>
            </StorageProvider>
          </ItemsProvider>
        </AuthProvider>
      </SettingsProvider>
    </GestureHandlerRootView>
  );
}
