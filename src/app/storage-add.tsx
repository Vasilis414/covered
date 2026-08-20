import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
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
import { Row, Section } from '@/components/ui/list';
import { Segmented } from '@/components/ui/segmented';
import { Motion } from '@/constants/motion';
import { Radius, Spacing, ListMetrics } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isPdf } from '@/lib/attachments';
import { scanStorageViaApi } from '@/lib/api';
import { persistPhoto, deletePhoto } from '@/lib/photos';
import { useAuth } from '@/store/auth';
import { useStorage, type StorageItem } from '@/store/storage';

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

  async function analyzePhotoWithAi(uri: string) {
    if (!uri || isPdf(uri)) return;
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
      if (isPdf(stored)) {
        setPdfUri(stored);
        setPhotoUris((current) => [...current, stored]);
      } else {
        setPhotoUris((current) => [...current, stored]);
        void analyzePhotoWithAi(stored);
      }
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

  function choosePhotoSource() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take photo', 'Choose from library'],
          cancelButtonIndex: 0,
        },
        (index) => {
          if (index === 1) takePhoto();
          if (index === 2) void pickFromLibrary();
        },
      );
      return;
    }
    Alert.alert('Add ticket or card', undefined, [
      { text: 'Take photo', onPress: () => takePhoto() },
      { text: 'Choose from library', onPress: () => void pickFromLibrary() },
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
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
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

            {analyzing ? (
              <Animated.View
                entering={FadeInDown.duration(Motion.standard)}
                style={[styles.aiBanner, { backgroundColor: theme.fill, borderColor: theme.accent }]}>
                <ActivityIndicator size="small" color={theme.accent} />
                <ThemedText style={[styles.aiBannerText, { color: theme.accent }]}>
                  AI is scanning ticket, barcode & expiry date…
                </ThemedText>
              </Animated.View>
            ) : null}

            <Section>
              <Row
                title={photoUris.length > 0 ? 'Add another photo' : 'Photograph ticket or pass'}
                subtitle={
                  photoUris.length > 0
                    ? undefined
                    : 'Covered auto-detects titles, barcodes and expiry dates'
                }
                icon="camera-outline"
                onPress={choosePhotoSource}
              />
            </Section>

            {photoUris.length > 0 ? (
              <View style={styles.thumbnailSection}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailList}>
                  {photoUris.map((uri, index) => (
                    <Pressable
                      key={uri}
                      onPress={() => (isPdf(uri) ? setPdfUri(uri) : setViewerIndex(index))}
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
                    </Pressable>
                  ))}
                </ScrollView>
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
  aiBanner: {
    marginHorizontal: ListMetrics.horizontalInset,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  aiBannerText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
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
