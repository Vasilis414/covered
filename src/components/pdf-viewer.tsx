import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { displayName } from '@/lib/attachments';

/**
 * Full-screen PDF reader.
 *
 * iOS renders PDFs natively inside WKWebView, so a WebView pointed at the local
 * file is the whole implementation and costs nothing extra. Android's WebView
 * cannot, so there it hands off to whatever app the user already has — the same
 * behaviour as before, rather than a blank page pretending to be a reader.
 */
export function PdfViewer({
  uri,
  visible,
  onClose,
}: {
  uri: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible && Boolean(uri)} animationType="slide" onRequestClose={onClose}>
      {/* A modal is its own native root, so it needs its own inset provider. */}
      <SafeAreaProvider>
        {uri ? <PdfBody uri={uri} onClose={onClose} /> : null}
      </SafeAreaProvider>
    </Modal>
  );
}

function PdfBody({ uri, onClose }: { uri: string; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  async function openElsewhere() {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      }
    } catch {
      // The share sheet declining is not worth an error of its own.
    }
  }

  const canRenderInline = Platform.OS === 'ios';

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* MIN_TOP keeps the controls clear of the Dynamic Island, where taps
          are swallowed if a platform ever reports a zero inset. */}
      <View style={[styles.navBar, { paddingTop: Math.max(insets.top, 44), backgroundColor: theme.chrome, borderBottomColor: theme.separator }]}>
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12} style={styles.navButton}>
          <ThemedText type="body" style={{ color: theme.accent }}>
            Done
          </ThemedText>
        </Pressable>

        <ThemedText type="headline" numberOfLines={1} style={styles.navTitle}>
          {displayName(uri)}
        </ThemedText>

        <Pressable
          onPress={openElsewhere}
          accessibilityRole="button"
          accessibilityLabel="Open in another app"
          hitSlop={12}
          style={styles.navButton}>
          <Ionicons name="share-outline" size={20} color={theme.accent} />
        </Pressable>
      </View>

      {canRenderInline && !failed ? (
        <View style={styles.flex}>
          <WebView
            source={{ uri }}
            style={styles.flex}
            originWhitelist={['file://', 'https://']}
            allowFileAccess
            allowFileAccessFromFileURLs
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
          />
          {loading ? (
            <View style={[styles.centre, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, { backgroundColor: theme.background }]}>
              <ActivityIndicator />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.centre}>
          <Ionicons name="document-text-outline" size={48} color={theme.textTertiary} />
          <ThemedText type="headline" style={styles.fallbackTitle}>
            {failed ? 'Could not display this PDF' : 'Open with another app'}
          </ThemedText>
          <ThemedText type="subhead" themeColor="textSecondary" style={styles.fallbackBody}>
            {failed
              ? 'The file may be damaged. You can still open it elsewhere.'
              : 'Android cannot show PDFs inside an app, so this opens in your PDF reader.'}
          </ThemedText>
          <Pressable
            onPress={openElsewhere}
            accessibilityRole="button"
            style={[styles.primary, { backgroundColor: theme.accent }]}>
            <ThemedText type="headline" style={styles.primaryLabel}>
              Open
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
  navButton: { minWidth: 52 },
  navTitle: { flex: 1, textAlign: 'center' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.five },
  fallbackTitle: { marginTop: Spacing.two },
  fallbackBody: { textAlign: 'center' },
  primary: {
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.two + 4,
    borderRadius: 10,
  },
  primaryLabel: { color: '#FFFFFF' },
});
