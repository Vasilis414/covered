import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ListMetrics, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const COLUMNS = 3;
const GAP = 2;
const PAGE_SIZE = 90;

/**
 * An in-app replacement for the system photo picker.
 *
 * PHPickerViewController is hosted out-of-process, and when it misbehaves the
 * app has no recourse: it renders with the wrong frame and swallows every
 * touch, including its own Cancel button. This grid renders inside our own
 * view hierarchy, so layout and hit testing are ours to control.
 *
 * The trade-off is honest: this needs read access to the photo library, where
 * the system picker needs no permission at all.
 */
export function PhotoGridPicker({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (uri: string) => void;
}) {
  const theme = useTheme();
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied'>('loading');
  const [resolving, setResolving] = useState(false);

  const size = (Dimensions.get('window').width - GAP * (COLUMNS - 1)) / COLUMNS;

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      if (!permission.granted) {
        setStatus('denied');
        return;
      }
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [MediaLibrary.SortBy.creationTime],
        first: PAGE_SIZE,
      });
      setAssets(page.assets);
      setStatus('ready');
    } catch {
      setStatus('denied');
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  /**
   * `asset.uri` is a ph:// reference on iOS, which the OCR engine can't read,
   * so getAssetInfoAsync resolves it to a real file. On Android the plain uri
   * is usually already a file path, so a failure there is recoverable — fall
   * back rather than dropping the tap on the floor.
   */
  async function choose(asset: MediaLibrary.Asset) {
    if (resolving) return;
    setResolving(true);
    try {
      let uri = asset.uri;
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset);
        if (info?.localUri) uri = info.localUri;
      } catch {
        // Keep asset.uri.
      }

      onSelect(uri);
      onClose();
    } catch (error) {
      // Never fail silently: a tap that does nothing is impossible to debug.
      Alert.alert('Could not use that photo', String(error));
    } finally {
      setResolving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/*
        A RN Modal is its own native root, so the outer provider's insets don't
        reach it — SafeAreaView measures zero and the nav bar ends up under the
        Dynamic Island, where taps never land. A provider inside the modal
        measures the modal itself.
      */}
      <SafeAreaProvider>
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <PickerBody>
          <View style={[styles.navBar, { borderBottomColor: theme.separator, backgroundColor: theme.chrome }]}>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
              <ThemedText type="body" style={{ color: theme.accent }}>
                Cancel
              </ThemedText>
            </Pressable>
            <ThemedText type="headline">Choose a photo</ThemedText>
            <View style={styles.navSpacer} />
          </View>

          {status === 'loading' ? (
            <View style={styles.centre}>
              <ActivityIndicator />
            </View>
          ) : status === 'denied' ? (
            <View style={styles.centre}>
              <Ionicons name="lock-closed-outline" size={44} color={theme.textTertiary} />
              <ThemedText type="headline" style={styles.deniedTitle}>
                No photo access
              </ThemedText>
              <ThemedText type="subhead" themeColor="textSecondary" style={styles.deniedBody}>
                Allow photo access in Settings, or use Take photo instead.
              </ThemedText>
            </View>
          ) : assets.length === 0 ? (
            <View style={styles.centre}>
              <Ionicons name="images-outline" size={44} color={theme.textTertiary} />
              <ThemedText type="subhead" themeColor="textSecondary" style={styles.deniedBody}>
                No photos on this device yet.
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={assets}
              keyExtractor={(asset) => asset.id}
              numColumns={COLUMNS}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={{ gap: GAP }}
              ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => choose(item)}
                  accessibilityRole="button"
                  accessibilityLabel="Photo"
                  style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Image
                    source={{ uri: item.uri }}
                    style={{ width: size, height: size }}
                    contentFit="cover"
                  />
                </Pressable>
              )}
            />
          )}
        </PickerBody>
      </View>
      </SafeAreaProvider>
    </Modal>
  );
}

/**
 * Applies the modal's own top inset, with a floor so the Cancel button can
 * never end up under the Dynamic Island where taps don't register.
 */
function PickerBody({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.flex, { paddingTop: Math.max(insets.top, 44) }]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: ListMetrics.horizontalInset,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navSpacer: { width: 52 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  deniedTitle: { marginTop: Spacing.two },
  deniedBody: { textAlign: 'center', paddingHorizontal: Spacing.five },
  grid: { paddingBottom: Spacing.four },
});
