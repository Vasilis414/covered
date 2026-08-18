import { Ionicons } from '@expo/vector-icons';
import BarcodeScanning, { BarcodeFormat } from '@react-native-ml-kit/barcode-scanning';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  UIManager,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DigitalCode } from '@/components/digital-code';
import { PdfViewer } from '@/components/pdf-viewer';
import { PhotoViewer } from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { BarTextButton, ScreenBar } from '@/components/ui/screen-bar';
import { NativeHeaderText } from '@/components/ui/native-header-action';
import { InputRow } from '@/components/ui/input-row';
import { Section } from '@/components/ui/list';
import { Segmented } from '@/components/ui/segmented';
import { Motion } from '@/constants/motion';
import { Radius, Spacing, ListMetrics } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isPdf } from '@/lib/attachments';
import { scanStorageViaApi } from '@/lib/api';
import { persistPhoto, deletePhoto } from '@/lib/photos';
import { useAuth } from '@/store/auth';
import { useStorage } from '@/store/storage';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

type ItemType = 'ticket' | 'receipt' | 'barcode' | 'other';

const TYPES: { value: ItemType; label: string }[] = [
  { value: 'ticket', label: 'Ticket' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'barcode', label: 'Card' },
  { value: 'other', label: 'Other' },
];

export default function StorageAddScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { addStorageItem } = useStorage();
  const { getIdToken } = useAuth();

  const [name, setName] = useState('');
  const [type, setType] = useState<ItemType>('ticket');
  const [notes, setNotes] = useState('');
  const [barcodePayload, setBarcodePayload] = useState('');
  const [barcodeFormat, setBarcodeFormat] = useState<'QR_CODE' | 'CODE_128' | 'EAN_13' | 'CODE_39' | 'PDF417' | 'OTHER'>('CODE_128');
  const [expiresAt, setExpiresAt] = useState('');
  const { shared } = useLocalSearchParams<{ shared?: string }>();
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !saving && !analyzing;

  async function analyzePhotoWithAi(uri: string) {
    setAnalyzing(true);
    let detectedBarcode = '';
    let detectedFormat: 'QR_CODE' | 'CODE_128' | 'EAN_13' | 'CODE_39' | 'PDF417' | 'OTHER' = 'CODE_128';

    // 1. High-accuracy On-device MLKit Barcode & QR Decoder (Instant & 100% Offline)
    try {
      const barcodes = await BarcodeScanning.scan(uri);
      if (barcodes && barcodes.length > 0) {
        const first = barcodes[0];
        detectedBarcode = first.value || '';
        if (first.format === BarcodeFormat.QR_CODE) detectedFormat = 'QR_CODE';
        else if (first.format === BarcodeFormat.CODE_128) detectedFormat = 'CODE_128';
        else if (first.format === BarcodeFormat.EAN_13) detectedFormat = 'EAN_13';
        else if (first.format === BarcodeFormat.CODE_39) detectedFormat = 'CODE_39';
        else if (first.format === BarcodeFormat.PDF417) detectedFormat = 'PDF417';
        else detectedFormat = 'OTHER';

        if (detectedBarcode) {
          setBarcodePayload(detectedBarcode);
          setBarcodeFormat(detectedFormat);
        }
      }
    } catch (barcodeErr) {
      console.log('On-device barcode scan info:', barcodeErr);
    }

    // 2. Gemini Cloud AI for Ticket Title, Expiry & Document Metadata
    try {
      const token = await getIdToken();
      if (token) {
        const outcome = await scanStorageViaApi(token, uri);
        if (outcome.ok && outcome.scan) {
          const { scan } = outcome;
          if (scan.name) setName(scan.name);
          if (scan.type) setType(scan.type);
          if (!detectedBarcode && scan.barcodePayload) {
            setBarcodePayload(scan.barcodePayload);
            if (scan.barcodeFormat) setBarcodeFormat(scan.barcodeFormat);
          }
          if (scan.expiresAt) setExpiresAt(scan.expiresAt);
          if (scan.notes) {
            setNotes((current) => (current ? `${current}\n${scan.notes}` : scan.notes || ''));
          }

          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      }
    } catch (err) {
      console.warn('AI Storage scan failed:', err);
    } finally {
      setAnalyzing(false);
    }
  }

  /**
   * Same contract as the warranty add screen: a shared file is attached once.
   * acceptPhoto runs the on-device barcode decode and a cloud scan, so a repeat
   * would cost a request and duplicate the attachment.
   */
  const sharedHandled = useRef(false);
  useEffect(() => {
    if (!shared || sharedHandled.current) return;
    sharedHandled.current = true;
    acceptPhoto(shared);
  }, [shared]);

  function acceptPhoto(uri: string) {
    const stored = persistPhoto(uri);
    setPhotoUris((current) => [...current, stored]);
    // Automatically analyze with MLKit + AI
    void analyzePhotoWithAi(stored);
  }

  async function takePhoto() {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Covered needs camera access to photograph tickets & cards.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
      });

      if (result.canceled || !result.assets?.length) return;
      acceptPhoto(result.assets[0].uri);
    } catch {
      Alert.alert(
        'Camera unavailable',
        Platform.OS === 'ios'
          ? 'The simulator has no camera — choose from the library instead.'
          : 'Something went wrong opening the camera.',
      );
    }
  }

  async function handleAttach() {
    try {
      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.85,
        selectionLimit: 10,
      });

      if (result.canceled || !result.assets?.length) return;
      for (const asset of result.assets) {
        acceptPhoto(asset.uri);
      }
    } catch (err) {
      Alert.alert('Could not open photos', String(err));
    }
  }

  function handleRemovePhoto(index: number) {
    const target = photoUris[index];
    if (target) {
      deletePhoto(target);
      setPhotoUris((current) => current.filter((_, i) => i !== index));
    }
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      await addStorageItem({
        name: name.trim(),
        type,
        photoUris,
        notes: notes.trim() || undefined,
        barcodePayload: barcodePayload.trim() || undefined,
        barcodeFormat: barcodePayload.trim() ? barcodeFormat : undefined,
        expiresAt: expiresAt.trim() || undefined,
      });
      router.back();
    } catch (error) {
      Alert.alert('Could not save', String(error));
      setSaving(false);
    }
  }

  function handleCancel() {
    photoUris.forEach(deletePhoto);
    router.back();
  }

  const native = Platform.OS === 'ios';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {native ? (
          <Stack.Screen
            options={{
              headerShown: true,
              title: 'Add Stored Item',
              headerLeft: () => <NativeHeaderText label="Cancel" onPress={handleCancel} />,
              headerRight: () =>
                saving ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <NativeHeaderText
                    label="Save"
                    prominent
                    disabled={!canSave}
                    onPress={handleSave}
                  />
                ),
            }}
          />
        ) : (
          <ScreenBar
            title="Add Stored Item"
            left={<BarTextButton label="Cancel" onPress={handleCancel} />}
            right={
              saving ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <BarTextButton label="Save" prominent disabled={!canSave} onPress={handleSave} />
              )
            }
          />
        )}

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* AI Analyzing banner */}
          {analyzing ? (
            <Animated.View entering={FadeInDown.duration(Motion.standard)} style={[styles.aiBanner, { backgroundColor: theme.fill, borderColor: theme.accent }]}>
              <ActivityIndicator size="small" color={theme.accent} />
              <ThemedText style={[styles.aiBannerText, { color: theme.accent }]}>
                AI is scanning ticket, barcode & expiry date…
              </ThemedText>
            </Animated.View>
          ) : null}

          <Section header="Item details">
            <InputRow
              label="Name"
              placeholder="e.g. Airport Parking ticket"
              value={name}
              onChangeText={setName}
              autoFocus={photoUris.length === 0}
            />
          </Section>

          <ThemedText type="caption" themeColor="textSecondary" style={styles.segmentedHeader}>
            Type
          </ThemedText>
          <Segmented options={TYPES} value={type} onChange={setType} />

          {/* Barcode & Expiry Section */}
          <Section header="Barcode & Expiry Reminders">
            <InputRow
              label="Barcode/QR"
              placeholder="Auto-detected code or paste text"
              value={barcodePayload}
              onChangeText={setBarcodePayload}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <InputRow
              label="Expires At"
              placeholder="YYYY-MM-DD or YYYY-MM-DDTHH:MM"
              value={expiresAt}
              onChangeText={setExpiresAt}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Section>

          {/* Digital Code Preview */}
          {barcodePayload.trim().length > 0 ? (
            <View style={styles.codePreviewWrapper}>
              <DigitalCode payload={barcodePayload} format={barcodeFormat} label={name || 'Barcode'} />
            </View>
          ) : null}

          <Section header="Notes & details">
            <InputRow
              label="Notes"
              placeholder="Zone, seat, or parking space info"
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </Section>

          <View style={styles.photoContainer}>
            <PdfViewer uri={pdfUri} visible={pdfUri !== null} onClose={() => setPdfUri(null)} />

            <PhotoViewer
              uris={photoUris.filter((uri) => !isPdf(uri))}
              initialIndex={viewerIndex ?? 0}
              visible={viewerIndex !== null}
              onClose={() => setViewerIndex(null)}
            />

            <View style={styles.photoLabelRow}>
              <ThemedText type="caption" themeColor="textSecondary">
                Photos & Tickets ({photoUris.length})
              </ThemedText>
            </View>

            <View style={styles.pickerButtons}>
              <Pressable
                onPress={takePhoto}
                style={({ pressed }) => [
                  styles.pickerButton,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.separator,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons name="camera-outline" size={22} color={theme.accent} />
                <ThemedText type="footnote" style={{ color: theme.accent, fontWeight: '500' }}>
                  Camera & AI Scan
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={handleAttach}
                style={({ pressed }) => [
                  styles.pickerButton,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.separator,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons name="images-outline" size={22} color={theme.accent} />
                <ThemedText type="footnote" style={{ color: theme.accent, fontWeight: '500' }}>
                  Photos
                </ThemedText>
              </Pressable>
            </View>

            {photoUris.length > 0 ? (
              <View style={styles.thumbnailActionSection}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.thumbnailList}
                >
                  {photoUris.map((uri, index) => (
                    <Pressable
                      key={uri}
                      onPress={() => (isPdf(uri) ? setPdfUri(uri) : setViewerIndex(index))}
                      style={styles.thumbnailWrapper}
                    >
                      <Animated.View entering={FadeInDown.duration(Motion.standard)}>
                        {isPdf(uri) ? (
                          <View style={[styles.thumbnail, styles.pdfThumbnail, { backgroundColor: theme.fill }]}>
                            <Ionicons name="document-text" size={26} color={theme.accent} />
                          </View>
                        ) : (
                          <Image
                            source={{ uri }}
                            style={styles.thumbnail}
                            contentFit="cover"
                            recyclingKey={uri}
                          />
                        )}
                      </Animated.View>
                      <Pressable
                        onPress={() => handleRemovePhoto(index)}
                        style={[styles.thumbnailDelete, { backgroundColor: theme.danger }]}
                      >
                        <Ionicons name="close" size={12} color="#fff" />
                      </Pressable>
                    </Pressable>
                  ))}
                </ScrollView>

                <Pressable
                  onPress={() => analyzePhotoWithAi(photoUris[0])}
                  disabled={analyzing}
                  style={({ pressed }) => [
                    styles.rescanButton,
                    {
                      backgroundColor: theme.fill,
                      borderColor: theme.accent,
                      opacity: pressed || analyzing ? 0.7 : 1,
                    },
                  ]}
                >
                  {analyzing ? (
                    <ActivityIndicator size="small" color={theme.accent} />
                  ) : (
                    <Ionicons name="sparkles" size={16} color={theme.accent} />
                  )}
                  <ThemedText style={[styles.rescanText, { color: theme.accent }]}>
                    {analyzing ? 'AI Scanning…' : 'Re-scan with AI'}
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: Spacing.three,
    paddingBottom: Spacing.six * 2,
  },
  aiBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: ListMetrics.horizontalInset,
    marginBottom: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  aiBannerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  codePreviewWrapper: {
    marginHorizontal: ListMetrics.horizontalInset,
    marginBottom: Spacing.two,
  },
  segmentedHeader: {
    marginHorizontal: ListMetrics.horizontalInset,
    marginBottom: Spacing.one + 2,
    textTransform: 'uppercase',
  },
  photoContainer: {
    marginHorizontal: ListMetrics.horizontalInset,
    marginTop: Spacing.four,
  },
  photoLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.two,
    textTransform: 'uppercase',
  },
  pickerButtons: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  pickerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.three,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumbnailList: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  thumbnailWrapper: {
    width: 72,
    height: 72,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  pdfThumbnail: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailDelete: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
  },
  thumbnailActionSection: {
    gap: Spacing.two,
  },
  rescanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
    marginTop: Spacing.one,
  },
  rescanText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
