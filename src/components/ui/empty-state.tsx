import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Motion } from '@/constants/motion';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(Motion.standard)}
      style={styles.container}>
      <Ionicons name={icon} size={52} color={theme.textTertiary} />
      <ThemedText type="title3" style={styles.title}>
        {title}
      </ThemedText>
      <ThemedText type="subhead" themeColor="textSecondary" style={styles.body}>
        {body}
      </ThemedText>
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
});
