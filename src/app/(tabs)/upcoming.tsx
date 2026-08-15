import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ItemRow } from '@/components/item-row';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { LargeTitleScreen } from '@/components/ui/large-title-screen';
import { Section } from '@/components/ui/list';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { daysRemaining, expiryDate } from '@/lib/warranty';
import { useItems } from '@/store/items';
import { useSettings } from '@/store/settings';
import type { WarrantyItem } from '@/types/item';

function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function UpcomingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { items, removeItem } = useItems();
  const { reminderOffsets } = useSettings();

  /** Only cover that hasn't lapsed — this tab is about what you can still act on. */
  const pending = useMemo(
    () => items.filter((item) => daysRemaining(item) >= 0).sort((a, b) => daysRemaining(a) - daysRemaining(b)),
    [items],
  );

  const months = useMemo(() => {
    const buckets = new Map<string, WarrantyItem[]>();
    pending.forEach((item) => {
      const key = monthLabel(expiryDate(item));
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    });
    return [...buckets.entries()];
  }, [pending]);

  const nextNinety = pending.filter((item) => daysRemaining(item) <= 90).length;
  const soonest = pending[0];

  return (
    <LargeTitleScreen title="Upcoming">
      {pending.length === 0 ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="Nothing due"
          body="No active warranties are counting down. Add an item and it'll show up here."
        />
      ) : (
        <>
          <View style={[styles.hero, { backgroundColor: theme.card }]}>
            <ThemedText type="largeTitle" style={{ color: theme.accent }}>
              {nextNinety}
            </ThemedText>
            <ThemedText type="subhead" themeColor="textSecondary" style={styles.heroCaption}>
              {nextNinety === 1 ? 'warranty ends' : 'warranties end'} in the next 90 days
            </ThemedText>
            {soonest ? (
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.heroCaption}>
                Next up: {soonest.name}, in {daysRemaining(soonest)} day
                {daysRemaining(soonest) === 1 ? '' : 's'}
              </ThemedText>
            ) : null}
          </View>

          {months.map(([label, monthItems]) => (
            <Section key={label} header={label}>
              {monthItems.map((item, rowIndex) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={rowIndex}
                  onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
                  onDelete={() => removeItem(item.id)}
                />
              ))}
            </Section>
          ))}

          <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
            {reminderOffsets.length > 0
              ? `You'll be reminded ${reminderOffsets.join(', ')} days before each one ends.`
              : 'Reminders are switched off — turn them back on in Settings.'}
          </ThemedText>
        </>
      )}

      <View style={styles.tabInset} />
    </LargeTitleScreen>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.four,
    padding: Spacing.three,
    borderRadius: Radius.md,
    alignItems: 'center',
    gap: Spacing.half,
  },
  heroCaption: { textAlign: 'center' },
  note: {
    textAlign: 'center',
    marginTop: -Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  tabInset: { height: Spacing.six + Spacing.four },
});
