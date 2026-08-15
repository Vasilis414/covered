import { Ionicons } from '@expo/vector-icons';
import { useRef, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/ui/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { ListMetrics, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const NAV_BAR_HEIGHT = 44;
/** How far you scroll before the large title hands over to the compact bar. */
const HANDOVER_START = 16;
const HANDOVER_END = 42;

export type SearchConfig = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
};

/**
 * The iOS navigation pattern: a large title that scrolls away into a compact
 * bar. Built on Animated rather than native large titles so Android gets the
 * identical behaviour instead of a plain header.
 */
export function LargeTitleScreen({
  title,
  actionIcon,
  onActionPress,
  actionLabel,
  search,
  children,
}: {
  title: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  onActionPress?: () => void;
  actionLabel?: string;
  search?: SearchConfig;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;

  const compactOpacity = scrollY.interpolate({
    inputRange: [HANDOVER_START, HANDOVER_END],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  /**
   * Pull past the top and the large title stretches, the way it does across
   * iOS. It costs one interpolation and it is the difference between a list
   * that has a top and a list that feels attached to something.
   */
  const titleScale = scrollY.interpolate({
    inputRange: [-160, 0],
    outputRange: [1.14, 1],
    extrapolateRight: 'clamp',
  });

  const headerHeight = insets.top + NAV_BAR_HEIGHT;

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Animated.ScrollView
        contentContainerStyle={{ paddingTop: headerHeight + Spacing.two }}
        scrollEventThrottle={16}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}>
        <View style={[styles.largeTitle, !search && styles.largeTitleAlone]}>
          {/* Scaled from the left edge so the text grows outwards, not sideways. */}
          <Animated.View
            style={{ transform: [{ scale: titleScale }], transformOrigin: 'left center' }}>
            <ThemedText type="largeTitle">{title}</ThemedText>
          </Animated.View>
        </View>

        {search ? <SearchField {...search} /> : null}

        {children}
      </Animated.ScrollView>

      {/* Compact bar sits above the content and fades in on scroll. */}
      <View
        style={[
          styles.header,
          { height: headerHeight, paddingTop: insets.top, pointerEvents: 'box-none' },
        ]}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.chrome, opacity: compactOpacity, pointerEvents: 'none' },
          ]}
        />
        <Animated.View
          style={[
            styles.hairline,
            { backgroundColor: theme.separator, opacity: compactOpacity, pointerEvents: 'none' },
          ]}
        />

        <View style={styles.headerRow}>
          <Animated.View style={{ opacity: compactOpacity, pointerEvents: 'none' }}>
            <ThemedText type="headline" numberOfLines={1}>
              {title}
            </ThemedText>
          </Animated.View>

          {actionIcon && onActionPress ? (
            <PressableScale
              onPress={onActionPress}
              accessibilityRole="button"
              accessibilityLabel={actionLabel ?? 'Action'}
              hitSlop={12}
              scaleTo={0.88}
              style={styles.action}>
              <Ionicons name={actionIcon} size={26} color={theme.accent} />
            </PressableScale>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function SearchField({ value, onChangeText, placeholder }: SearchConfig) {
  const theme = useTheme();

  return (
    <View style={[styles.search, { backgroundColor: theme.fill }]}>
      <Ionicons name="search" size={17} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={[styles.searchInput, { color: theme.text }]}
      />
      {value.length > 0 && Platform.OS !== 'ios' ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={17} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  hairline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ListMetrics.horizontalInset,
  },
  action: { marginLeft: 'auto' },
  largeTitle: {
    paddingHorizontal: ListMetrics.horizontalInset,
    paddingBottom: Spacing.two,
  },
  /** Without a search field underneath, the title needs its own breathing room. */
  largeTitleAlone: { paddingBottom: Spacing.four },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
    marginHorizontal: ListMetrics.horizontalInset,
    marginBottom: Spacing.four,
    paddingHorizontal: Spacing.two,
    height: 36,
    borderRadius: Radius.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    padding: 0,
  },
});
