import { Ionicons } from '@expo/vector-icons';

import { BackButton, BarIconButton, ScreenBar } from '@/components/ui/screen-bar';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as FileSystem from 'expo-file-system/legacy';

import { extensionForMime, isPdf, mimeTypeFor } from '@/lib/attachments';
import { DigitalCode } from '@/components/digital-code';
import { PdfViewer } from '@/components/pdf-viewer';
import { PhotoViewer } from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/ui/list';
import { Motion } from '@/constants/motion';
import { Radius, Spacing, ListMetrics } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/store/auth';
import { useStorage, type StorageItem } from '@/store/storage';

/** Keeps the shared filename readable and free of anything a path dislikes. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim();
  return cleaned.slice(0, 60) || 'attachment';
}

export default function StorageDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { getStorageItem, removeStorageItem } = useStorage();
  const { getIdToken } = useAuth();

  const item = getStorageItem(id);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);

  const typeLabels: Record<StorageItem['type'], string> = {
    ticket: 'Ticket / Pass',
    receipt: 'Receipt / Invoice',
    barcode: 'Card / Member Barcode',
    other: 'Document / Other',
  };

  const expiryInfo = useMemo(() => {
    if (!item?.expiresAt) return null;
    const expiry = new Date(item.expiresAt);
    const expiryTime = expiry.getTime();
    if (isNaN(expiryTime)) return null;

    const diffMs = expiryTime - Date.now();
    const isExpired = diffMs <= 0;

    let timeText = '';
    if (isExpired) {
      timeText = `Expired on ${expiry.toLocaleDateString()} at ${expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const days = Math.floor(hours / 24);

      if (days > 0) {
        timeText = `Expires in ${days}d ${hours % 24}h (${expiry.toLocaleDateString()})`;
      } else if (hours > 0) {
        timeText = `Expires in ${hours}h ${mins}m (${expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      } else {
        timeText = `Expires in ${mins} minutes!`;
      }
    }

    return {
      isExpired,
      text: timeText,
      formattedDate: expiry.toLocaleString(),
    };
  }, [item?.expiresAt]);

  if (!item) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View style={styles.notFound}>
          <ThemedText type="headline">Item not found</ThemedText>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <ThemedText style={{ color: theme.accent }}>Go back</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  function handleDelete() {
    if (!item) return;
    Alert.alert('Delete Item', `Are you sure you want to remove "${item.name}" from your storage?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!item) return;
          if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await removeStorageItem(item.id);
          router.back();
        },
      },
    ]);
  }

  /**
   * Shares the first attachment that is actually usable.
   *
   * Not simply photoUris[0]: after a restore some entries can be dead local
   * paths while later ones are fine, so the visible photo and the shared file
   * were not always the same thing. Each candidate is checked — a local file
   * for existence, a remote one by fetching it — and the first that works is
   * the one shared.
   */
  async function handleShare() {
    if (!item || item.photoUris.length === 0) return;

    const problems: string[] = [];

    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Could not share', 'Sharing is not available on this device.');
        return;
      }

      for (const source of item.photoUris) {
        try {
          if (source.startsWith('file://')) {
            const info = await FileSystem.getInfoAsync(source);
            if (!info.exists) {
              problems.push('one attachment is no longer stored on this device');
              continue;
            }
            await Sharing.shareAsync(source, { mimeType: mimeTypeFor(source) });
            return;
          }

          const token = getIdToken();
          const scratch = `${FileSystem.cacheDirectory}share-${item.id}`;
          const result = await FileSystem.downloadAsync(
            source,
            scratch,
            token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
          );
          if (result.status !== 200) {
            problems.push(`download failed (${result.status})`);
            continue;
          }

          /**
           * The server URL ends in a bare id, so the download arrives with no
           * extension and iOS cannot tell what it is. Name it from the
           * Content-Type the server sent.
           */
          const mimeType =
            result.headers['Content-Type'] ?? result.headers['content-type'] ?? 'image/jpeg';
          const named = `${FileSystem.cacheDirectory}${safeFileName(item.name)}.${extensionForMime(mimeType)}`;
          await FileSystem.deleteAsync(named, { idempotent: true });
          await FileSystem.moveAsync({ from: result.uri, to: named });

          await Sharing.shareAsync(named, {
            mimeType,
            UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined,
          });
          return;
        } catch (error) {
          // Report what actually went wrong rather than assuming a cause.
          problems.push(String(error));
        }
      }

      Alert.alert(
        'Could not share',
        problems.length > 0 ? problems.join('\n') : 'Nothing could be shared.',
      );
    } catch (error) {
      Alert.alert('Could not share', String(error));
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <ScreenBar
        title={item.name}
        left={<BackButton onPress={() => router.back()} />}
        right={
          <>
            {item.photoUris.length > 0 ? (
              <BarIconButton
                symbol="square.and.arrow.up"
                ionicon="share-outline"
                label="Share"
                onPress={handleShare}
              />
            ) : null}
            <BarIconButton
              symbol="trash"
              ionicon="trash-outline"
              label="Delete"
              color={theme.danger}
              onPress={handleDelete}
            />
          </>
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Expiry Pill */}
        {expiryInfo ? (
          <Animated.View
            entering={FadeInDown.duration(Motion.standard)}
            style={[
              styles.expiryBanner,
              {
                backgroundColor: expiryInfo.isExpired ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                borderColor: expiryInfo.isExpired ? theme.danger : '#F59E0B',
              },
            ]}
          >
            <Ionicons
              name={expiryInfo.isExpired ? 'alert-circle-outline' : 'time-outline'}
              size={20}
              color={expiryInfo.isExpired ? theme.danger : '#D97706'}
            />
            <ThemedText
              style={[
                styles.expiryText,
                { color: expiryInfo.isExpired ? theme.danger : '#B45309' },
              ]}
            >
              {expiryInfo.text}
            </ThemedText>
          </Animated.View>
        ) : null}

        {/* Digital Barcode / QR Code */}
        {item.barcodePayload ? (
          <Animated.View entering={FadeInDown.duration(Motion.standard).delay(50)} style={styles.barcodeSection}>
            <DigitalCode
              payload={item.barcodePayload}
              format={item.barcodeFormat}
              label={item.name}
            />
          </Animated.View>
        ) : null}

        {/* Photos & Attachments Grid */}
        {item.photoUris.length > 0 ? (
          <Section header={`Photos & Documents (${item.photoUris.length})`}>
            <View style={styles.photosGrid}>
              {item.photoUris.map((uri, idx) => (
                <Pressable
                  key={uri}
                  onPress={() => (isPdf(uri) ? setPdfUri(uri) : setViewerIndex(idx))}
                  style={({ pressed }) => [
                    styles.photoWrapper,
                    { borderColor: theme.separator, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  {isPdf(uri) ? (
                    <View style={[styles.photoThumb, styles.pdfThumb, { backgroundColor: theme.fill }]}>
                      <Ionicons name="document-text" size={28} color={theme.accent} />
                    </View>
                  ) : (
                    <Image
                      source={{ uri }}
                      style={styles.photoThumb}
                      contentFit="cover"
                      /* A camera photo is ~48MB decoded at full size. Several of
                         those in one scroll view is what was killing the app. */
                      recyclingKey={uri}
                      transition={120}
                    />
                  )}
                  <View style={styles.expandPill}>
                    <Ionicons name="expand" size={12} color="#fff" />
                    <ThemedText style={styles.expandText}>Tap to open</ThemedText>
                  </View>
                </Pressable>
              ))}
            </View>
          </Section>
        ) : null}

        {/* Details & Metadata */}
        <Section header="Item Information">
          <View style={styles.infoRow}>
            <ThemedText type="footnote" themeColor="textSecondary">
              Category
            </ThemedText>
            <ThemedText type="footnote" style={{ fontWeight: '500' }}>
              {typeLabels[item.type]}
            </ThemedText>
          </View>

          {item.expiresAt ? (
            <View style={[styles.infoRow, { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Expiration
              </ThemedText>
              <ThemedText type="footnote" style={{ fontWeight: '500' }}>
                {new Date(item.expiresAt).toLocaleString()}
              </ThemedText>
            </View>
          ) : null}

          {item.barcodePayload ? (
            <View style={[styles.infoRow, { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Barcode Code
              </ThemedText>
              <ThemedText type="footnote" style={{ fontWeight: '600', fontFamily: 'Courier' }}>
                {item.barcodePayload}
              </ThemedText>
            </View>
          ) : null}

          <View style={[styles.infoRow, { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <ThemedText type="footnote" themeColor="textSecondary">
              Added to Vault
            </ThemedText>
            <ThemedText type="footnote" style={{ fontWeight: '500' }}>
              {new Date(item.createdAt).toLocaleDateString()}
            </ThemedText>
          </View>
        </Section>

        {/* Notes */}
        {item.notes ? (
          <Section header="Notes">
            <View style={styles.notesBox}>
              <ThemedText type="body" style={styles.notesText}>
                {item.notes}
              </ThemedText>
            </View>
          </Section>
        ) : null}
      </ScrollView>

      {/* Full-screen Photo Viewer */}
      <PdfViewer uri={pdfUri} visible={pdfUri !== null} onClose={() => setPdfUri(null)} />

      <PhotoViewer
        uris={item.photoUris.filter((uri) => !isPdf(uri))}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: Spacing.four,
    paddingBottom: Spacing.six * 2,
  },
  expiryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: ListMetrics.horizontalInset,
    marginBottom: Spacing.four,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  expiryText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  barcodeSection: {
    marginHorizontal: ListMetrics.horizontalInset,
    marginBottom: Spacing.four,
  },
  pdfThumb: { alignItems: 'center', justifyContent: 'center' },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  photoWrapper: {
    width: '100%',
    height: 220,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  expandPill: {
    position: 'absolute',
    bottom: Spacing.two,
    right: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.65)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  expandText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: ListMetrics.horizontalInset,
  },
  notesBox: {
    padding: Spacing.four,
  },
  notesText: {
    lineHeight: 22,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.four,
  },
  backButton: {
    padding: Spacing.two,
  },
});
