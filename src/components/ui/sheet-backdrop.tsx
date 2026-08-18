import { BlurView } from 'expo-blur';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { useResolvedScheme } from '@/hooks/use-theme';

/**
 * The dimmed layer behind a sheet.
 *
 * iOS gets a real blur, the way system sheets dim what is behind them; the
 * flat 40% black stays everywhere else, because Android's blur is expensive
 * and does not match. The sheet card itself stays opaque on purpose — glass
 * over a dimmed backdrop loses too much text contrast.
 */
export function SheetBackdrop({ onPress }: { onPress: () => void }) {
  const scheme = useResolvedScheme();

  if (Platform.OS === 'ios') {
    return (
      <Pressable style={styles.backdrop} onPress={onPress} accessibilityLabel="Dismiss">
        <BlurView
          tint={scheme === 'dark' ? 'systemThickMaterialDark' : 'systemThickMaterialLight'}
          intensity={40}
          style={StyleSheet.absoluteFill}
        />
      </Pressable>
    );
  }

  return <Pressable style={[styles.backdrop, styles.dim]} onPress={onPress} accessibilityLabel="Dismiss" />;
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dim: { backgroundColor: 'rgba(0,0,0,0.4)' },
});
