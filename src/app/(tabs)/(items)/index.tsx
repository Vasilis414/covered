import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ItemRow } from '@/components/item-row';
import { UpsellSheet, type UpsellReason } from '@/components/upsell-sheet';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { LargeTitleScreen } from '@/components/ui/large-title-screen';
import { NativeHeaderAction } from '@/components/ui/native-header-action';
import { Section } from '@/components/ui/list';
import { Segmented } from '@/components/ui/segmented';
import { Motion } from '@/constants/motion';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { daysRemaining, statusOf, type WarrantyStatus } from '@/lib/warranty';
import { useAuth } from '@/store/auth';
import { useItems } from '@/store/items';
import { FREE_ITEM_LIMIT } from '@/lib/limits';
import type { WarrantyItem } from '@/types/item';

type Filter = 'all' | WarrantyStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Soon' },
  { value: 'expired', label: 'Expired' },
];

const GROUP_ORDER: { status: WarrantyStatus; header: string }[] = [
  { status: 'expiring', header: 'Expiring soon' },
  { status: 'active', header: 'Active cover' },
  { status: 'expired', header: 'Expired' },
];

function matchesQuery(item: WarrantyItem, query: string): boolean {
  return [item.name, item.brand, item.retailer, item.serialNumber, item.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);
}

export default function ItemsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { items, removeItem } = useItems();
  const { signedIn, entitlement } = useAuth();
  const [upsell, setUpsell] = useState<UpsellReason>(null);

  const premium = Boolean(entitlement?.paid);
  // Nudge once the library is worth protecting, not on an empty app.
  const showPrompt = items.length >= 2 && !premium;
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((item) => filter === 'all' || statusOf(item) === filter)
      .filter((item) => !needle || matchesQuery(item, needle))
      .sort((a, b) => daysRemaining(a) - daysRemaining(b));
  }, [items, filter, query]);

  // Grouping by urgency is only meaningful when everything is on screen.
  const groups = useMemo(() => {
    if (filter !== 'all') return [{ header: undefined, items: visible }];
    return GROUP_ORDER.map(({ status, header }) => ({
      header,
      items: visible.filter((item) => statusOf(item) === status),
    })).filter((group) => group.items.length > 0);
  }, [visible, filter]);

  function open(id: string) {
    router.push({ pathname: '/item/[id]', params: { id } });
  }

  const body = (
    <>
      <Segmented options={FILTERS} value={filter} onChange={setFilter} />

      {showPrompt ? (
        <Animated.View entering={FadeInDown.duration(Motion.standard)}>
        <Pressable
          onPress={() => setUpsell(signedIn ? 'backup' : 'items')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.prompt,
            { backgroundColor: theme.accentSoft, opacity: pressed ? 0.85 : 1 },
          ]}>
          <Ionicons
            name={signedIn ? 'cloud-upload' : 'logo-google'}
            size={20}
            color={theme.accent}
          />
          <View style={styles.promptText}>
            <ThemedText type="footnote" style={{ color: theme.accent, fontWeight: '600' }}>
              {signedIn ? 'Back up your receipts' : 'Sign in to protect your items'}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {signedIn
                ? 'Premium keeps your receipts safe and backed up.'
                : `Free covers ${FREE_ITEM_LIMIT} items. Sign in to scan receipts with AI.`}
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.accent} />
        </Pressable>
        </Animated.View>
      ) : null}



      {visible.length === 0 ? (
        <EmptyState
          icon={items.length === 0 ? 'receipt-outline' : 'search-outline'}
          sfSymbol={items.length === 0 ? 'doc.text.image' : 'magnifyingglass'}
          title={items.length === 0 ? 'No items yet' : 'No matches'}
          body={
            items.length === 0
              ? 'Covered warns you before a warranty runs out.'
              : 'Try a different search or filter.'
          }
          actionLabel={items.length === 0 ? 'Add your first item' : undefined}
          onAction={items.length === 0 ? () => router.push('/add') : undefined}
        />
      ) : (
        groups.map((group, index) => (
          <Section key={group.header ?? index} header={group.header}>
            {group.items.map((item, rowIndex) => (
              <ItemRow
                key={item.id}
                item={item}
                index={rowIndex}
                onPress={() => open(item.id)}
                onDelete={() => removeItem(item.id)}
              />
            ))}
          </Section>
        ))
      )}

      {items.length > 0 ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.count}>
          {items.length} item{items.length === 1 ? '' : 's'} tracked
        </ThemedText>
      ) : null}

      <UpsellSheet reason={upsell} onClose={() => setUpsell(null)} />

      <View style={styles.tabInset} />
    </>
  );

  /**
   * iOS hands the title and the search field to the native nav bar, so the
   * screen is just a scroll view underneath it. `automatic` inset adjustment
   * is what makes the content start below the large title and slide under it.
   */
  if (Platform.OS === 'ios') {
    return (
      <>
        <Stack.Screen
          options={{
            title: 'Warranties',
            headerRight: () => (
              <NativeHeaderAction
                symbol="plus"
                label="Add item"
                onPress={() => router.push('/add')}
              />
            ),
            headerSearchBarOptions: {
              placeholder: 'Search',
              onChangeText: (event) => setQuery(event.nativeEvent.text),
              onClose: () => setQuery(''),
              hideWhenScrolling: false,
            },
          }}
        />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {body}
        </ScrollView>
      </>
    );
  }

  return (
    <LargeTitleScreen
      title="Warranties"
      actionIcon="add"
      actionLabel="Add item"
      onActionPress={() => router.push('/add')}
      search={{ value: query, onChangeText: setQuery, placeholder: 'Search' }}>
      {body}
    </LargeTitleScreen>
  );
}

const styles = StyleSheet.create({
  count: { textAlign: 'center', marginTop: -Spacing.two },
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.four,
    padding: Spacing.three,
    borderRadius: Radius.md,
  },
  promptText: { flex: 1, gap: 1 },
  tabInset: { height: Spacing.six + Spacing.four },
});
