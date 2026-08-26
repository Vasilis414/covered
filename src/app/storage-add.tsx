import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { isPdf } from '@/lib/attachments';
import { scanStorageViaApi } from '@/lib/api';
import { persistPhoto, deletePhoto } from '@/lib/photos';
import { useAuth } from '@/store/auth';
import { useStorage, type StorageItem } from '@/store/storage';
import * as DocumentPicker from 'expo-document-picker';
import { openAttachment } from '@/lib/open-attachment';
import { CaptureCard } from '@/components/ui/capture-card';
import { ScanningCaption, ScanningOverlay } from '@/components/ui/scanning-overlay';

type ItemType = 'ticket' | 'receipt' | 'barcode' | 'other';

const TYPES: { value: ItemType; label: string }[] = [
  { value: 'ticket', label: 'Ticket' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'barcode', label: 'Card' },
  { value: 'other', label: 'Other' },
];

export default function StorageAddScreen() {
  const { id, shared } = useLocalSearchParams<{ id?: string; shared?: string }>();
  const { ready, getStorageItem } = useStorage();

  if (id && !ready) return null;

  const existing = id ? getStorageItem(id) : undefined;
  return <StorageForm key={existing?.id ?? 'new'} existing={existing} shared={shared} />;
}

function StorageForm({
  existing,
  shared,
}: {
  existing?: StorageItem;
  shared?: string;
}) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const router = useRouter();
  const { addStorageItem, updateStorageItem } = useStorage();
  const { getIdToken } = useAuth();

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<ItemType>(existing?.type ?? 'ticket');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [barcodePayload, setBarcodePayload] = useState(existing?.barcodePayload ?? '');
  const [barcodeFormat, setBarcodeFormat] = useState<'QR_CODE' | 'CODE_128' | 'EAN_13' | 'CODE_39' | 'PDF417' | 'OTHER'>(
    existing?.barcodeFormat ?? 'CODE_128',
  );
  const [expiresAt, setExpiresAt] = useState(existing?.expiresAt ?? '');
  const [photoUris, setPhotoUris] = useState<string[]>(existing?.photoUris ?? []);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !saving && !analyzing;

  /**
   * Reads a ticket, card or document — PDFs included.
   *
   * PDFs used to be refused outright here and in acceptPhoto, so an emailed
   * ticket was filed with no title, no barcode and no expiry while a photo of
   * the same ticket was read fully. The scan endpoint has always sent the real
   * MIME type and Gemini reads PDFs natively; the guard was the only thing
   * stopping it.
   */
  async function analyzePhotoWithAi(uri: string) {
    if (!uri) return;
    setAnalyzing(true);

    try {
      const token = await getIdToken();
      if (token) {
        const outcome = await scanStorageViaApi(token, uri);
        if (outcome.ok && outcome.scan) {
          const { scan } = outcome;
          if (scan.name && !name.trim()) setName(scan.name);
          if (scan.type) setType(scan.type);
          if (scan.barcodePayload && !barcodePayload.trim()) {
            setBarcodePayload(scan.barcodePayload);
            if (scan.barcodeFormat) setBarcodeFormat(scan.barcodeFormat);
          }
          if (scan.expiresAt && !expiresAt.trim()) setExpiresAt(scan.expiresAt);
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

  const sharedHandled = useRef(false);
  useEffect(() => {
    if (!shared || sharedHandled.current) return;
    sharedHandled.current = true;
    acceptPhoto(shared);
  }, [shared]);

  function acceptPhoto(uri: string) {
    try {
      const stored = persistPhoto(uri);
      setPhotoUris((current) => [...current, stored]);
      /**
       * No longer opens the viewer for a PDF.
       *
       * Attaching one threw the reader up over the form before the scan could
       * fill anything in, so the first thing after picking a file was
       * dismissing a viewer nobody asked for.
       */
      void analyzePhotoWithAi(stored);
    } catch (e) {
      console.warn('Failed to accept photo:', e);
    }
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

  async function pickFromLibrary() {
    try {
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

  /**
   * Attaching a PDF, the same way a warranty item does.
   *
   * The rest of this screen already handled PDFs — isPdf guards the scan path,
   * and the tile renderer draws a document icon for them — but the picker menu
   * never offered one, so a ticket that arrived as a PDF could not be added at
   * all. Tickets are emailed as PDFs more often than as photos.
   */
  async function attachPdf() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const stored = persistPhoto(result.assets[0].uri);
      setPhotoUris((current) => [...current, stored]);
    } catch {
      Alert.alert('Could not attach', 'Something went wrong opening that file.');
    }
  }

  function choosePhotoSource() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take photo', 'Choose from library', 'Attach a PDF'],
          cancelButtonIndex: 0,
        },
        (index) => {
          if (index === 1) takePhoto();
          if (index === 2) void pickFromLibrary();
          if (index === 3) void attachPdf();
        },
      );
      return;
    }
    Alert.alert('Add ticket or card', undefined, [
      { text: 'Take photo', onPress: () => takePhoto() },
      { text: 'Choose from library', onPress: () => void pickFromLibrary() },
      { text: 'Attach a PDF', onPress: () => void attachPdf() },
      { text: 'Cancel', style: 'cancel' },
    ]);
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
      if (existing) {
        await updateStorageItem(existing.id, {
          name: name.trim(),
          type,
          photoUris,
          notes: notes.trim() || undefined,
          barcodePayload: barcodePayload.trim() || undefined,
          barcodeFormat: barcodePayload.trim() ? barcodeFormat : undefined,
          expiresAt: expiresAt.trim() || undefined,
        });
      } else {
        await addStorageItem({
          name: name.trim(),
          type,
          photoUris,
          notes: notes.trim() || undefined,
          barcodePayload: barcodePayload.trim() || undefined,
          barcodeFormat: barcodePayload.trim() ? barcodeFormat : undefined,
          expiresAt: expiresAt.trim() || undefined,
        });
      }
      router.back();
    } catch (error) {
      Alert.alert('Could not save', String(error));
      setSaving(false);
    }
  }

  const native = Platform.OS === 'ios';

  return (
    <View
      style={[
        styles.screen,
        /**
         * A flat ground, not the ambient backdrop.
         *
         * The backdrop belongs to the browsing screens, where it gives the
         * glass something to sample. A form is chrome: drifting colour behind
         * input fields fights the content, and the nav bar sitting over it
         * read as a muddy teal band in both appearances. Solid white in
         * Light, black in Dark.
         */
        { backgroundColor: scheme === 'dark' ? '#000000' : '#FFFFFF' },
      ]}>
      {native ? (
        <Stack.Screen
          options={{
            headerShown: true,
            title: existing ? 'Edit Stored Item' : 'New Stored Item',
            headerLeft: () => (
              <NativeHeaderText label="Cancel" onPress={() => router.back()} />
            ),
            headerRight: () => (
              <NativeHeaderText label="Save" prominent disabled={!canSave} onPress={handleSave} />
            ),
          }}
        />
      ) : null}

      <SafeAreaView style={styles.flex} edges={native ? ['left', 'right'] : ['top', 'left', 'right']}>
        {native ? null : (
          <ScreenBar
            filled
            title={existing ? 'Edit Stored Item' : 'New Stored Item'}
            left={<BarTextButton label="Cancel" onPress={() => router.back()} />}
            right={<BarTextButton label="Save" prominent disabled={!canSave} onPress={handleSave} />}
          />
        )}

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}>

            <CaptureCard
              onPress={choosePhotoSource}
              hasPhotos={photoUris.length > 0}
              canScan
              scanning={analyzing}
              title="Photograph ticket or pass"
              body="Covered reads the title, barcode and expiry off it."
              scanningBody="Reading the barcode and expiry date."
            />

            {photoUris.length > 0 ? (
              <View style={styles.thumbnailSection}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailList}>
                  {photoUris.map((uri, index) => (
                    <Pressable
                      key={uri}
                      onPress={() =>
                        void openAttachment(photoUris, index, () =>
                          isPdf(uri) ? setPdfUri(uri) : setViewerIndex(index),
                        )
                      }
                      style={styles.thumbnailWrapper}>
                      <Animated.View entering={FadeInDown.duration(Motion.standard)}>
                        {isPdf(uri) ? (
                          <View style={[styles.thumbnail, styles.pdfThumbnail, { backgroundColor: theme.fill }]}>
                            <Ionicons name="document-text" size={26} color={theme.accent} />
                          </View>
                        ) : (
                          <Image source={{ uri }} style={styles.thumbnail} contentFit="cover" recyclingKey={uri} />
                        )}
                      </Animated.View>
                      <Pressable onPress={() => handleRemovePhoto(index)} style={[styles.thumbnailDelete, { backgroundColor: theme.danger }]}>
                        <Ionicons name="close" size={12} color="#fff" />
                      </Pressable>
                      {analyzing && index === photoUris.length - 1 ? <ScanningOverlay /> : null}
                    </Pressable>
                  ))}

                  {/* Add affordance lives in the strip, as on the warranty form. */}
                  <Pressable
                    onPress={choosePhotoSource}
                    disabled={analyzing}
                    accessibilityRole="button"
                    accessibilityLabel="Add another photo"
                    style={({ pressed }) => [
                      styles.thumbnail,
                      styles.addTile,
                      { borderColor: theme.separator, opacity: pressed ? 0.6 : 1 },
                    ]}>
                    <Ionicons name="add" size={26} color={theme.accent} />
                  </Pressable>
                </ScrollView>

                {analyzing ? <ScanningCaption label="Reading the ticket…" /> : null}
              </View>
            ) : null}

            <Section header="Item details">
              <InputRow
                label="Name"
                placeholder="e.g. Boarding Pass, Gym Card, Ticket"
                value={name}
                onChangeText={setName}
                autoFocus={photoUris.length === 0 && !existing}
              />
            </Section>

            <ThemedText type="caption" themeColor="textSecondary" style={styles.segmentedHeader}>
              Type
            </ThemedText>
            <Segmented options={TYPES} value={type} onChange={setType} />

            <Section header="Barcode & Expiry">
              <InputRow
                label="Code / QR"
                placeholder="Barcode data or link"
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

            {barcodePayload.trim().length > 0 ? (
              <View style={styles.codePreviewWrapper}>
                <DigitalCode payload={barcodePayload} format={barcodeFormat} label={name || 'Barcode'} />
              </View>
            ) : null}

            <Section header="Notes">
              <InputRow
                label="Notes"
                placeholder="Zone, seat, or parking space info"
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </Section>

            <PdfViewer uri={pdfUri} visible={pdfUri !== null} onClose={() => setPdfUri(null)} />
            <PhotoViewer
              uris={photoUris.filter((uri) => !isPdf(uri))}
              initialIndex={viewerIndex ?? 0}
              visible={viewerIndex !== null}
              onClose={() => setViewerIndex(null)}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: {
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  segmentedHeader: {
    paddingHorizontal: ListMetrics.horizontalInset,
    marginTop: Spacing.two,
  },
  thumbnailSection: {
    paddingHorizontal: ListMetrics.horizontalInset,
  },
  thumbnailList: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  thumbnailWrapper: {
    position: 'relative',
  },
  addTile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  thumbnail: {
    width: 68,
    height: 68,
    borderRadius: Radius.md,
  },
  pdfThumbnail: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailDelete: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codePreviewWrapper: {
    paddingHorizontal: ListMetrics.horizontalInset,
  },
});
