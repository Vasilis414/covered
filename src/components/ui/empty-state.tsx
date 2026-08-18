import { Ionicons } from '@expo/vector-icons';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Platform, StyleSheet } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GlassButton } from '@/components/ui/glass-button';
import { Motion } from '@/constants/motion';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * An empty state: a glyph, a title, one line explaining what to do, and — when
 * there is a next step — a button for it.
 *
 * iOS draws an SF Symbol where one is given, which is the system's own icon set
 * and carries its weight and optical alignment for free. Android and any screen
 * that hasn't picked a symbol yet fall back to the Ionicon, so this stays a
 * drop-in for the existing callers.
 */
export function EmptyState({
  icon,
  sfSymbol,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  /** iOS only. Falls back to `icon` when absent or on Android. */
  sfSymbol?: SFSymbol;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const useSymbol = Platform.OS === 'ios' && Boolean(sfSymbol);

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(Motion.standard)}
      style={styles.container}>
      {useSymbol ? (
        <SymbolView
          name={sfSymbol!}
          size={52}
          tintColor={theme.textTertiary}
          type="hierarchical"
          fallback={<Ionicons name={icon} size={52} color={theme.textTertiary} />}
        />
      ) : (
        <Ionicons name={icon} size={52} color={theme.textTertiary} />
      )}

      <ThemedText type="title3" style={styles.title}>
        {title}
      </ThemedText>
      <ThemedText type="subhead" themeColor="textSecondary" style={styles.body}>
        {body}
      </ThemedText>

      {actionLabel && onAction ? (
        <GlassButton label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: Spacing.six,
    paddingHorizontal: Spacing.five,
    gap: Spacing.two,
  },
  title: { marginTop: Spacing.two },
  body: { textAlign: 'center' },
  action: {
    marginTop: Spacing.three,
    alignSelf: 'center',
    minWidth: 220,
  },
});
