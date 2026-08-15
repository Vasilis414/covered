import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
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

import { PhotoGridPicker } from '@/components/photo-grid-picker';
import { PhotoViewer } from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { InputRow } from '@/components/ui/input-row';
import { Row, Section } from '@/components/ui/list';
import { Segmented } from '@/components/ui/segmented';
import { Motion } from '@/constants/motion';
import { Radius, Spacing, ListMetrics } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { persistPhoto, deletePhoto } from '@/lib/photos';
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

  const [name, setName] = useState('');
  const [type, setType] = useState<ItemType>('ticket');
  const [notes, setNotes] = useState('');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const canSave = name.trim().length > 0 && !saving;

  function acceptPhoto(uri: string) {
    const stored = persistPhoto(uri);
    setPhotoUris((current) => [...current, stored]);
  }

  async function takePhoto() {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Covered needs camera access to photograph attachments.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.6,
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

  function handleAttach() {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setLibraryOpen(true);
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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={[styles.header, { borderBottomColor: theme.separator }]}>
          <Pressable onPress={handleCancel} style={styles.headerButton}>
            <ThemedText style={{ color: theme.accent, fontSize: 16 }}>Cancel</ThemedText>
          </Pressable>
          <ThemedText type="headline" style={styles.headerTitle}>
            Add Stored Item
          </ThemedText>
          <Pressable onPress={handleSave} disabled={!canSave} style={styles.headerButton}>
            {saving ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : (
              <ThemedText
                style={{
                  color: canSave ? theme.accent : theme.textTertiary,
                  fontWeight: '600',
                  fontSize: 16,
                }}
              >
                Save
              </ThemedText>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Section header="Item details">
            <InputRow
              label="Name"
              placeholder="e.g. Airport Parking ticket"
              value={name}
              onChangeText={setName}
              autoFocus
            />
          </Section>

          <ThemedText type="caption" themeColor="textSecondary" style={styles.segmentedHeader}>
            Type
          </ThemedText>
          <Segmented options={TYPES} value={type} onChange={setType} />

          <Section header="Notes & photos">
            <InputRow
              label="Notes"
              placeholder="Optional notes or details"
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </Section>

          <View style={styles.photoContainer}>
            <PhotoViewer
              uris={photoUris}
              initialIndex={viewerIndex ?? 0}
              visible={viewerIndex !== null}
              onClose={() => setViewerIndex(null)}
            />

            <View style={styles.photoLabelRow}>
              <ThemedText type="caption" themeColor="textSecondary">
                Photos ({photoUris.length})
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
                  Camera
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
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.thumbnailList}
              >
                {photoUris.map((uri, index) => (
                  <Pressable
                    key={uri}
                    onPress={() => setViewerIndex(index)}
                    style={styles.thumbnailWrapper}
                  >
                    <Animated.Image
                      entering={FadeInDown.duration(Motion.standard)}
                      source={{ uri }}
                      style={styles.thumbnail}
                    />
                    <Pressable
                      onPress={() => handleRemovePhoto(index)}
                      style={[styles.thumbnailDelete, { backgroundColor: theme.danger }]}
                    >
                      <Ionicons name="close" size={12} color="#fff" />
                    </Pressable>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        </ScrollView>

        <PhotoGridPicker
          visible={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          onSelect={acceptPhoto}
        />
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
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    minWidth: 60,
    justifyContent: 'center',
    paddingVertical: Spacing.two,
  },
  headerTitle: {
    fontWeight: '600',
  },
  scrollContent: {
    paddingVertical: Spacing.three,
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
});
