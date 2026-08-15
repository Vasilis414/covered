import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';

import { CategoryIcon } from '@/components/category-icon';
import { ThemedText } from '@/components/themed-text';
import { Motion } from '@/constants/motion';
import { ListMetrics, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { daysRemaining, formatRemaining, statusOf } from '@/lib/warranty';
import type { WarrantyItem } from '@/types/item';

const STATUS_COLOR = { active: 'success', expiring: 'warning', expired: 'danger' } as const;

export function ItemRow({
  item,
  index = 0,
  onPress,
  onDelete,
}: {
  item: WarrantyItem;
  /** Position in the list, used to stagger the entrance. */
  index?: number;
  onPress: () => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const status = statusOf(item);
  const subtitle = [item.brand, item.retailer].filter(Boolean).join(' · ') || item.category;

  /**
   * Opacity only, no travel. Rows sit inside a card that clips its contents and
   * draws hairline separators between them; anything that slides would cross
   * separators that stay put, which looks like a rendering fault.
   */
  const entering = reduceMotion
    ? undefined
    : FadeIn.duration(Motion.standard).delay(
        Math.min(index, Motion.maxStaggered) * Motion.stagger,
      );

  return (
    <Animated.View
      entering={entering}
      exiting={reduceMotion ? undefined : FadeOut.duration(Motion.quick)}
      layout={reduceMotion ? undefined : LinearTransition.duration(Motion.standard)}>
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          onPress={() => {
            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${item.name}`}
          style={[styles.deleteAction, { backgroundColor: theme.danger }]}>
          <Ionicons name="trash" size={20} color="#FFFFFF" />
        </Pressable>
      )}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatRemaining(daysRemaining(item))}`}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? theme.cardPressed : theme.card },
        ]}>
        <CategoryIcon category={item.category} status={status} />

        <View style={styles.labels}>
          <ThemedText type="body" numberOfLines={1}>
            {item.name}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        </View>

        <ThemedText type="footnote" style={{ color: theme[STATUS_COLOR[status]] }} numberOfLines={1}>
          {formatRemaining(daysRemaining(item))}
        </ThemedText>

        <Ionicons name="chevron-forward" size={17} color={theme.textTertiary} />
      </Pressable>
    </ReanimatedSwipeable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    paddingHorizontal: ListMetrics.horizontalInset,
    paddingVertical: Spacing.two + 2,
    gap: Spacing.two + 4,
  },
  labels: { flex: 1, gap: 1 },
  deleteAction: {
    width: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
