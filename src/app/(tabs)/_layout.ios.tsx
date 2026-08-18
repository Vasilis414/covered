import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { UpsellSheet } from '@/components/upsell-sheet';
import { useTheme } from '@/hooks/use-theme';
import { useSignInPrompt } from '@/hooks/use-signin-prompt';

/**
 * iOS gets the real UIKit tab bar rather than the JS one in `_layout.tsx`.
 *
 * That buys the system behaviours we cannot fake: on iOS 26 the bar is Liquid
 * Glass, it minimises to a pill as you scroll down and floats back on the way
 * up, and it goes opaque by itself when content reaches the edge. Below 26 the
 * same component falls back to the standard translucent bar — which is what
 * the hand-rolled `BlurView` was imitating anyway.
 *
 * Android and web keep `_layout.tsx`; nothing there changes.
 */
export default function TabsLayoutIOS() {
  const theme = useTheme();
  const { prompt, clearPrompt } = useSignInPrompt();

  return (
    <>
      <NativeTabs
        tintColor={theme.accent}
        iconColor={{ default: theme.textSecondary, selected: theme.accent }}
        labelStyle={{ fontSize: 10, fontWeight: '500' }}
        /**
         * The scroll-away pill. `automatic` currently resolves to "never" on
         * most screens, so ask for it explicitly.
         */
        minimizeBehavior="onScrollDown">
        <NativeTabs.Trigger name="(items)">
          <NativeTabs.Trigger.Label>Items</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'square.stack', selected: 'square.stack.fill' }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="upcoming">
          <NativeTabs.Trigger.Label>Upcoming</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'alarm', selected: 'alarm.fill' }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="storage">
          <NativeTabs.Trigger.Label>Storage Room</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'archivebox', selected: 'archivebox.fill' }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        </NativeTabs.Trigger>
      </NativeTabs>

      <UpsellSheet reason={prompt} onClose={clearPrompt} />
    </>
  );
}
