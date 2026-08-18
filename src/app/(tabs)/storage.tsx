import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View, Alert } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { UpsellSheet, type UpsellReason } from '@/components/upsell-sheet';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { LargeTitleScreen } from '@/components/ui/large-title-screen';
import { Section } from '@/components/ui/list';
import { Segmented } from '@/components/ui/segmented';
import { Motion } from '@/constants/motion';
import { Radius, Spacing, ListMetrics } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isPdf } from '@/lib/attachments';
import { useAuth } from '@/store/auth';
import { useStorage, type StorageItem } from '@/store/storage';

type FilterType = 'all' | 'ticket' | 'receipt' | 'barcode' | 'other';

const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ticket', label: 'Tickets' },
  { value: 'receipt', label: 'Receipts' },
  { value: 'barcode', label: 'Cards' },
  { value: 'other', label: 'Other' },
];

export default function StorageScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { storageItems, removeStorageItem } = useStorage();
  const { signedIn, entitlement, signInWithPlenum } = useAuth();
  const [upsell, setUpsell] = useState<UpsellReason>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [query, setQuery] = useState('');

  const premium = Boolean(entitlement?.paid);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return storageItems
      .filter((item) => filter === 'all' || item.type === filter)
      .filter((item) => !needle || item.name.toLowerCase().includes(needle))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [storageItems, filter, query]);

  function handleDelete(id: string, name: string) {
    Alert.alert('Delete Item', `Are you sure you want to delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeStorageItem(id) },
    ]);
  }

  return (
    <LargeTitleScreen
      title="Storage Room"
      actionIcon="add"
      actionLabel="Add to Storage"
      onActionPress={() => {
        if (!premium) {
          setUpsell('items');
        } else {
          router.push('/storage-add');
        }
      }}
      search={{ value: query, onChangeText: setQuery, placeholder: 'Search storage' }}
    >
      {!premium ? (
        <View style={styles.lockedContainer}>
          <EmptyState
            icon="lock-closed-outline"
            sfSymbol="lock.shield"
            title="Premium Storage Room"
            body="Store miscellaneous items like parking tickets, shopping receipts, and barcode loyalty cards securely in the cloud."
          />
          <View style={styles.actionBlock}>
            {!signedIn ? (
              <Pressable
                onPress={() => signInWithPlenum()}
                style={({ pressed }) => [
                  styles.plenumButton,
                  { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Ionicons name="cloud-outline" size={20} color="#fff" />
                <ThemedText style={styles.buttonText}>Sign in with Plenum SSO</ThemedText>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setUpsell('items')}
                style={({ pressed }) => [
                  styles.plenumButton,
                  { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <ThemedText style={styles.buttonText}>Upgrade to Premium</ThemedText>
              </Pressable>
            )}
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.footerNote}>
              Plenum SSO login automatically awards premium tier + 50MB of cloud storage.
            </ThemedText>
          </View>
        </View>
      ) : (
        <>
          <Segmented options={FILTERS} value={filter} onChange={setFilter} />

          {visible.length === 0 ? (
            <EmptyState
              icon="folder-open-outline"
              sfSymbol="tray"
              title="No items found"
              body={query ? "No items match your search." : "Your storage room is empty. Tap '+' to upload your first card or ticket."}
            />
          ) : (
            <Section header="Stored Files">
              {visible.map((item, index) => (
                <StorageItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  onPress={() => router.push(`/storage/${item.id}`)}
                  onDelete={() => handleDelete(item.id, item.name)}
                />
              ))}
            </Section>
          )}
        </>
      )}

      <UpsellSheet reason={upsell} onClose={() => setUpsell(null)} />
      <View style={styles.tabInset} />
    </LargeTitleScreen>
  );
}

function StorageItemRow({
  item,
  index,
  onPress,
  onDelete,
}: {
  item: StorageItem;
  index: number;
  onPress: () => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const thumbnail = item.photoUris[0];

  const typeLabels: Record<StorageItem['type'], string> = {
    ticket: 'Ticket',
    receipt: 'Receipt',
    barcode: 'Card',
    other: 'Other',
  };

  const typeIcons: Record<StorageItem['type'], keyof typeof Ionicons.glyphMap> = {
    ticket: 'ticket-outline',
    receipt: 'receipt-outline',
    barcode: 'barcode-outline',
    other: 'document-text-outline',
  };

  const isExpired = item.expiresAt ? new Date(item.expiresAt).getTime() < Date.now() : false;

  return (
    <Animated.View
      entering={FadeInDown.duration(Motion.standard).delay(Math.min(index * 40, 300))}
      style={[
        styles.row,
        {
          borderTopColor: index === 0 ? 'transparent' : theme.separator,
          borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Pressable onPress={onPress} style={styles.rowMainPressable}>
        <View style={[styles.thumbnailContainer, { backgroundColor: theme.fill }]}>
          {thumbnail && !isPdf(thumbnail) ? (
            <Image
              source={{ uri: thumbnail }}
              style={styles.thumbnail}
              contentFit="cover"
              recyclingKey={thumbnail}
            />
          ) : (
            <Ionicons
              name={thumbnail ? 'document-text' : typeIcons[item.type]}
              size={22}
              color={theme.textSecondary}
            />
          )}
        </View>

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <ThemedText type="body" style={styles.name} numberOfLines={1}>
              {item.name}
            </ThemedText>
            {item.barcodePayload ? (
              <View style={[styles.badge, { backgroundColor: theme.fill }]}>
                <Ionicons name="barcode-outline" size={12} color={theme.accent} />
              </View>
            ) : null}
            {item.expiresAt ? (
              <View style={[styles.badge, { backgroundColor: isExpired ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)' }]}>
                <Ionicons name="time-outline" size={12} color={isExpired ? theme.danger : '#D97706'} />
              </View>
            ) : null}
          </View>

          <View style={styles.meta}>
            <ThemedText type="caption" themeColor="textSecondary">
              {typeLabels[item.type]}
            </ThemedText>
            {item.notes ? (
              <>
                <ThemedText type="caption" themeColor="textTertiary">
                  {' • '}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1} style={styles.notes}>
                  {item.notes}
                </ThemedText>
              </>
            ) : null}
          </View>
        </View>
      </Pressable>

      <Pressable onPress={onDelete} style={styles.deleteButton}>
        <Ionicons name="trash-outline" size={18} color={theme.danger} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  lockedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: Spacing.six,
  },
  actionBlock: {
    width: '100%',
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.four,
    gap: Spacing.two,
    alignItems: 'center',
  },
  plenumButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: Radius.md,
    width: '100%',
    maxWidth: 320,
    gap: Spacing.two,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  footerNote: {
    textAlign: 'center',
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: ListMetrics.horizontalInset,
  },
  rowMainPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  thumbnailContainer: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.three,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  badge: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    fontWeight: '500',
    flexShrink: 1,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  notes: {
    flex: 1,
  },
  deleteButton: {
    padding: Spacing.two,
    marginLeft: Spacing.two,
  },
  tabInset: {
    height: Spacing.six + Spacing.four,
  },
});
