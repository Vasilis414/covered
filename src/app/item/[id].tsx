import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';

import { CategoryIcon } from '@/components/category-icon';
import { PdfViewer } from '@/components/pdf-viewer';
import { PhotoViewer } from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { Row, Section } from '@/components/ui/list';
import { BackButton, BarTextButton, ScreenBar } from '@/components/ui/screen-bar';
import { ProgressTrack } from '@/components/ui/progress-track';
import { ListMetrics, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  daysRemaining,
  expiryDate,
  formatDate,
  formatPrice,
  formatRemaining,
  formatWarrantyDays,
  formatWarrantyLength,
  parseLocalDate,
  statusOf,
} from '@/lib/warranty';
import { useItems } from '@/store/items';
import { displayName, isPdf } from '@/lib/attachments';
import { openAttachment as previewAttachment } from '@/lib/open-attachment';

const STATUS_COLOR = { active: 'success', expiring: 'warning', expired: 'danger' } as const;

export default function ItemDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getItem, removeItem } = useItems();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const item = getItem(id);

  if (!item) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.background }]}>
        <ThemedText type="headline">Item not found</ThemedText>
        <ThemedText type="subhead" themeColor="textSecondary">
          It may have been deleted.
        </ThemedText>
      </View>
    );
  }

  const expiry = expiryDate(item);
  const days = daysRemaining(item);
  const status = statusOf(item);
  const tone = theme[STATUS_COLOR[status]];

  // Share of the cover period already used, for the bar under the title.
  const purchased = parseLocalDate(item.purchaseDate).getTime();
  const total = expiry.getTime() - purchased;
  const progress = total > 0 ? Math.min(1, Math.max(0, (Date.now() - purchased) / total)) : 1;

  function confirmDelete() {
    Alert.alert('Delete item?', `“${item!.name}” and its reminders will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await removeItem(item!.id);
          router.back();
        },
      },
    ]);
  }

  async function openAttachment(uri: string) {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      }
    } catch {
      Alert.alert('Could not open', 'No app on this phone can open that file.');
    }
  }

  async function openClaim() {
    const url = item!.claimUrl;
    if (!url) return;
    const normalised = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    if (await Linking.canOpenURL(normalised)) Linking.openURL(normalised);
    else Alert.alert('Could not open link', normalised);
  }

  return (
    /**
     * The app draws this header itself rather than using the native stack one.
     * The native header centres its title and lets it expand: a long item name
     * grew over the back button and swallowed taps on it, which is why going
     * back worked for some items and not others. An ordinary Pressable in a row
     * cannot be covered by anything.
     */
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      {/* No separate chrome colour: the bar sits on the screen background, the
          same way the storage detail header does. */}
      <ScreenBar
        title={item.name}
        left={<BackButton onPress={() => router.back()} />}
        right={
          <BarTextButton label="Edit" onPress={() => router.push(`/add?id=${item.id}`)} />
        }
      />


    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>

      <View style={styles.hero}>
        <CategoryIcon category={item.category} status={status} size={64} />
        <ThemedText type="title" style={styles.name}>
          {item.name}
        </ThemedText>
        <ThemedText type="subhead" themeColor="textSecondary">
          {[item.brand, item.retailer].filter(Boolean).join(' · ') || item.category}
        </ThemedText>
        <ThemedText type="headline" style={{ color: tone }}>
          {formatRemaining(days)}
        </ThemedText>

        <ProgressTrack
          progress={progress}
          color={tone}
          trackColor={theme.fill}
          style={styles.track}
        />
      </View>

      {item.photoUris.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
          {item.photoUris.map((uri, index) => (
            <Pressable
              key={uri}
              onPress={() =>
                void previewAttachment(item.photoUris, index, () =>
                  isPdf(uri) ? setPdfUri(uri) : setViewerIndex(index),
                )
              }
              accessibilityRole="imagebutton"
              accessibilityLabel={isPdf(uri) ? 'Open PDF' : 'Open photo full screen'}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
              {isPdf(uri) ? (
                <View style={[styles.photo, styles.pdfTile, { backgroundColor: theme.fill }]}>
                  <Ionicons name="document-text" size={34} color={theme.accent} />
                  <ThemedText type="footnote" numberOfLines={1} themeColor="textSecondary">
                    {displayName(uri)}
                  </ThemedText>
                </View>
              ) : (
                <Image source={{ uri }} style={styles.photo} contentFit="cover" />
              )}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <PdfViewer uri={pdfUri} visible={pdfUri !== null} onClose={() => setPdfUri(null)} />

      <PhotoViewer
        uris={item.photoUris.filter((uri) => !isPdf(uri))}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />

      <Section header="Cover">
        <Row title="Ends" value={formatDate(expiry)} />
        <Row title="Purchased" value={formatDate(parseLocalDate(item.purchaseDate))} />
        <Row
            title="Length"
            value={
              item.warrantyDays
                ? formatWarrantyDays(item.warrantyDays)
                : formatWarrantyLength(item.warrantyMonths)
            }
          />
        <Row title="Category" value={item.category} />
      </Section>

      {item.price !== undefined || item.serialNumber ? (
        <Section header="Details">
          {item.price !== undefined ? <Row title="Price" value={formatPrice(item.price)} /> : null}
          {item.serialNumber ? <Row title="Serial" value={item.serialNumber} /> : null}
        </Section>
      ) : null}

      {item.notes ? (
        <Section header="Notes">
          <View style={styles.notes}>
            <ThemedText type="body">{item.notes}</ThemedText>
          </View>
        </Section>
      ) : null}

      {item.claimUrl ? (
        <Section>
          <Row title="Start a claim" icon="open-outline" onPress={openClaim} />
        </Section>
      ) : null}

      <Section>
        <Row title="Delete item" destructive centered onPress={confirmDelete} chevron={false} />
      </Section>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  content: { paddingTop: Spacing.four, paddingBottom: Spacing.six },
  hero: {
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    marginBottom: Spacing.four,
    gap: Spacing.one + 2,
  },
  name: { textAlign: 'center', marginTop: Spacing.two },
  track: {
    height: 6,
    width: '100%',
    borderRadius: Radius.pill,
    overflow: 'hidden',
    marginTop: Spacing.two,
  },
  photoRow: {
    gap: Spacing.two,
    paddingHorizontal: ListMetrics.horizontalInset,
    paddingBottom: Spacing.four,
  },
  photo: { width: 200, height: 140, borderRadius: Radius.md },
  pdfTile: { alignItems: 'center', justifyContent: 'center', gap: Spacing.one, padding: Spacing.two },
  notes: { paddingHorizontal: ListMetrics.horizontalInset, paddingVertical: Spacing.two + 3 },
});
