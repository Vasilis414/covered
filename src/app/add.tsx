import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  UIManager,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORY_ICON } from '@/components/category-icon';
import { PdfViewer } from '@/components/pdf-viewer';
import { PhotoViewer } from '@/components/photo-viewer';
import { CustomWarrantySheet, type CustomWarranty } from '@/components/custom-warranty-sheet';
import { UpsellSheet, type UpsellReason } from '@/components/upsell-sheet';
import { Breathing } from '@/components/ui/breathing';
import { Motion } from '@/constants/motion';
import { ThemedText } from '@/components/themed-text';
import { BarTextButton, ScreenBar } from '@/components/ui/screen-bar';
import { NativeHeaderText } from '@/components/ui/native-header-action';
import { InputRow } from '@/components/ui/input-row';
import { Row, Section } from '@/components/ui/list';
import { ListMetrics, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { readReceipt, type ReadSource } from '@/lib/receipt-reader';
import { FREE_ITEM_LIMIT } from '@/lib/limits';
import { useAuth } from '@/store/auth';
import { acceptScan } from '@/lib/api';
import { deletePhoto, persistPhoto } from '@/lib/photos';
import { displayName, isPdf } from '@/lib/attachments';
import type { ReceiptLineItem, ReceiptScan } from '@/lib/receipt-parse';
import { expiryDate, formatDate, formatPrice, parseLocalDate, toISODate } from '@/lib/warranty';
import { useItems } from '@/store/items';
import { CATEGORIES, type Category, type WarrantyItem } from '@/types/item';
import { AmbientBackdrop } from '@/components/ui/ambient-backdrop';
import { ScreenTint } from '@/constants/design';
// Aliased: this screen already has its own openAttachment for share/open-in.
import { openAttachment as previewAttachment } from '@/lib/open-attachment';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const LENGTH_PRESETS = [6, 12, 24, 36, 60];

/** Most things in a category ship with the same cover, so guess it for them. */
const DEFAULT_MONTHS: Record<Category, number> = {
  Electronics: 12,
  Appliance: 24,
  Furniture: 24,
  Vehicle: 36,
  Tools: 12,
  Other: 12,
};

function lengthLabel(months: number): string {
  return months < 12 ? `${months} mo` : `${months / 12} yr`;
}

/**
 * Doubles as the edit screen: pass an `id` and it loads that item, retitles
 * itself and saves over the original instead of creating a second one.
 */
export default function AddItemScreen() {
  const { id, shared } = useLocalSearchParams<{ id?: string; shared?: string }>();
  const { ready, getItem } = useItems();

  // The store hydrates asynchronously. Mounting the form before it lands would
  // seed every field from an item that doesn't exist yet, and useState
  // initialisers never re-run — so wait, then mount once with real values.
  if (id && !ready) return null;

  const existing = id ? getItem(id) : undefined;
  return <ItemForm key={existing?.id ?? 'new'} existing={existing} shared={shared} />;
}

function ItemForm({
  existing,
  /** A photo or PDF shared in from another app, attached on mount. */
  shared,
}: {
  existing?: WarrantyItem;
  shared?: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { addItem, updateItem, items } = useItems();
  const { getIdToken, entitlement, signedIn, refresh } = useAuth();

  const [name, setName] = useState(existing?.name ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [retailer, setRetailer] = useState(existing?.retailer ?? '');
  const [category, setCategory] = useState<Category>(existing?.category ?? 'Electronics');
  const [purchaseDate, setPurchaseDate] = useState(() =>
    existing ? parseLocalDate(existing.purchaseDate) : new Date(),
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [warrantyMonths, setWarrantyMonths] = useState(existing?.warrantyMonths ?? 12);
  const [price, setPrice] = useState(existing?.price !== undefined ? String(existing.price) : '');
  const [serialNumber, setSerialNumber] = useState(existing?.serialNumber ?? '');
  const [claimUrl, setClaimUrl] = useState(existing?.claimUrl ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [photoUris, setPhotoUris] = useState<string[]>(existing?.photoUris ?? []);
  // When editing, the optional fields are likely why they came here.
  const [showMore, setShowMore] = useState(Boolean(existing));
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [detected, setDetected] = useState<ReceiptLineItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [upsell, setUpsell] = useState<UpsellReason>(null);
  const [warrantyDays, setWarrantyDays] = useState<number | undefined>(existing?.warrantyDays);
  /** Snapshot of the fields the AI filled, to judge whether it got them right. */
  const [aiFilled, setAiFilled] = useState<Record<string, string> | null>(null);

  const canSave = name.trim().length > 0 && !saving;
  // Premium reads every receipt; free accounts get a single taster scan.
  const canScan =
    Boolean(entitlement?.paid) || (entitlement?.scansRemaining ?? 0) > 0;
  const expiry = expiryDate({ purchaseDate: toISODate(purchaseDate), warrantyMonths, warrantyDays });
  const boughtToday = toISODate(purchaseDate) === toISODate(new Date());

  function chooseCategory(next: Category) {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    setCategory(next);
    setWarrantyDays(undefined);
    setWarrantyMonths(DEFAULT_MONTHS[next]);
  }

  function applyCustomWarranty(result: CustomWarranty) {
    if (result.kind === 'days') {
      setWarrantyDays(result.days);
      // Keep a rough month value so anything reading only months stays sane.
      setWarrantyMonths(Math.max(1, Math.round(result.days / 30)));
    } else {
      setWarrantyDays(undefined);
      setWarrantyMonths(result.months);
    }
  }

  /**
   * Shared tail of both routes in. Attaching the photo is synchronous and
   * happens first; OCR runs afterwards in the background. Reading the receipt
   * is a bonus, so a slow or failing scan must never hold up — or lose — the
   * photo the user just picked.
   */
  /**
   * A file shared in from another app arrives as a route param. It is attached
   * once and only once — acceptPhoto starts an OCR request, so re-running it on
   * every render would spend scans.
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

    const premium = Boolean(entitlement?.paid);
    const tasterLeft = (entitlement?.scansRemaining ?? 0) > 0;

    // Reading receipts is the paid feature. Free accounts get exactly one
    // taster through the API and nothing after it — not even the on-device
    // reader, which would otherwise be a free substitute for what we sell.
    if (!premium && !tasterLeft) {
      setScanNote(null);
      if (signedIn) setUpsell('scan');
      return;
    }

    setScanning(true);
    readReceipt(stored, getIdToken(), premium)
      .then(({ scan, source, limitReached }) => {
        applyScan(scan, source);
        if (limitReached) {
          setUpsell('scan');
          return;
        }
        // Nothing is pitched here: whether this scan was any good is decided
        // when the user saves it, not the moment it lands.
      })
      .catch(() => setScanNote("Couldn't read that one — fill it in by hand."))
      .finally(() => setScanning(false));
  }

  async function takePhoto() {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Covered needs camera access to photograph receipts.');
        return;
      }

      // The camera goes through UIImagePickerController in-process, unlike the
      // system library picker, so it isn't affected by the PHPicker problems
      // that made us build our own grid.
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

  /**
   * Fills only what's still blank. A scan is a guess, and silently overwriting
   * something the user typed would be worse than not scanning at all.
   */
  /**
   * Records what the AI put in the form. Compared against the form at save
   * time: unchanged means the scan was good and is worth charging for.
   * Takes the values explicitly — reading state here would capture the values
   * from before the setters ran.
   */
  function markAiFilled(snapshot: Record<string, string>) {
    setAiFilled(snapshot);
  }

  function applyScan(scan: ReceiptScan | null, source: ReadSource = 'device') {
    if (!scan) {
      setScanNote("Couldn't read that one — fill it in by hand.");
      return;
    }

    const read = source === 'ai' ? 'Read by AI' : 'Read on device';

    const filled: string[] = [];

    if (scan.retailer && !retailer.trim()) {
      setRetailer(scan.retailer);
      filled.push('shop');
    }
    // Only when the date is untouched, so a scan can't move a date they set.
    if (scan.purchaseDate && !existing && boughtToday) {
      setPurchaseDate(parseLocalDate(scan.purchaseDate));
      filled.push('purchase date');
    }

    // A receipt with several products is several warranties. Filling in the
    // grand total would be wrong for every one of them, so ask instead.
    if (scan.lineItems.length > 1) {
      setDetected(scan.lineItems);
      setScanNote(
        `${read}: ${scan.lineItems.length} products on this receipt — pick the one you're tracking.`,
      );
      return;
    }

    const single = scan.lineItems[0];
    if (single) {
      if (!name.trim()) {
        setName(single.description);
        filled.push('item');
      }
      if (!price.trim()) {
        setPrice(single.price.toFixed(2));
        filled.push('price');
      }
    } else if (scan.price !== undefined && !price.trim()) {
      setPrice(scan.price.toFixed(2));
      filled.push('price');
    }

    if (filled.length === 0) {
      setScanNote('Read the receipt, but nothing new to fill in.');
      return;
    }

    const list =
      filled.length === 1
        ? filled[0]
        : `${filled.slice(0, -1).join(', ')} and ${filled.at(-1)}`;
    setScanNote(`${read}: filled in the ${list} — worth a check.`);
    if (source === 'ai') {
      markAiFilled({
        name: (name.trim() || scan.lineItems[0]?.description || '').trim(),
        retailer: (retailer.trim() || scan.retailer || '').trim(),
        price: price.trim() || (single ? single.price.toFixed(2) : (scan.price?.toFixed(2) ?? '')),
        purchaseDate: scan.purchaseDate ?? toISODate(purchaseDate),
      });
    }
    setShowMore(true);
  }

  /**
   * Commits one detected product as the item being tracked, along with
   * everything inferred from its name. Only fills blanks — anything already
   * typed wins over a guess.
   */
  function chooseDetected(item: ReceiptLineItem) {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    setName(item.description);
    setPrice(item.price.toFixed(2));
    if (item.brand && !brand.trim()) setBrand(item.brand);
    if (item.category) setCategory(item.category);
    if (item.warrantyMonths) setWarrantyMonths(item.warrantyMonths);
    setScanNote(null);
    markAiFilled({
      name: item.description,
      retailer: retailer.trim() || '',
      price: item.price.toFixed(2),
      purchaseDate: toISODate(purchaseDate),
    });
  }

  async function attachPdf() {
    if (!Boolean(entitlement?.paid)) {
      setUpsell('backup');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      acceptPhoto(result.assets[0].uri);
    } catch {
      Alert.alert('Could not attach', 'Something went wrong opening that file.');
    }
  }

  /** PDFs can't be shown inline, so hand them to whatever app can open them. */
  async function openAttachment(uri: string) {
    if (!isPdf(uri)) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      }
    } catch {
      Alert.alert('Could not open', 'No app on this phone can open that file.');
    }
  }

  async function pickFromLibrary() {
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
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: () => takePhoto() },
      { text: 'Choose from library', onPress: () => void pickFromLibrary() },
      { text: 'Attach a PDF', onPress: () => void attachPdf() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function toggleMore() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowMore((open) => !open);
  }

  async function save() {
    if (!canSave) return;

    // Items live only on the device, so this cap is the app's to enforce.
    const overFreeLimit =
      !existing && !entitlement?.paid && items.length >= FREE_ITEM_LIMIT;
    if (overFreeLimit) {
      setUpsell('items');
      return;
    }

    setSaving(true);

    const draft = {
      name: name.trim(),
      brand: brand.trim() || undefined,
      retailer: retailer.trim() || undefined,
      category,
      purchaseDate: toISODate(purchaseDate),
      warrantyMonths,
      warrantyDays,
      price: price ? Number(price) || undefined : undefined,
      serialNumber: serialNumber.trim() || undefined,
      claimUrl: claimUrl.trim() || undefined,
      notes: notes.trim() || undefined,
      photoUris,
    };

    try {
      if (existing) {
        await updateItem(existing.id, draft);
        // Photos dropped during the edit are now unreachable — bin the files.
        existing.photoUris.filter((uri) => !photoUris.includes(uri)).forEach(deletePhoto);
      } else {
        await addItem(draft);
      }
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // The scan only costs a free credit if the user kept it as it came.
      const token = getIdToken();
      const untouched =
        aiFilled !== null &&
        aiFilled.name === name.trim() &&
        aiFilled.retailer === retailer.trim() &&
        aiFilled.price === price.trim() &&
        aiFilled.purchaseDate === toISODate(purchaseDate);

      if (token && untouched && !entitlement?.paid) {
        await acceptScan(token);
        await refresh();
        // Celebrate where it happened, then leave once they dismiss it.
        setSaving(false);
        setUpsell('magic');
        return;
      }

      router.back();
    } catch {
      setSaving(false);
      Alert.alert('Could not save', 'Please try again.');
    }
  }

  const native = Platform.OS === 'ios';

  return (
    <View style={styles.screen}>
      {/*
        A modal is presented over the navigator, so the root backdrop sits
        behind it rather than under it. With no ground of its own the screen
        fell through to the presentation container — black in both
        appearances, which read as a black bar beneath the transparent nav
        bar in Light.
      */}
      <AmbientBackdrop tint={ScreenTint.warranties} />
      {/* iOS draws the modal's bar natively — glass, and the system's own
          Cancel/Save placement. Android keeps the in-flow ScreenBar. */}
      {native ? (
        <Stack.Screen
          options={{
            headerShown: true,
            title: existing ? 'Edit Item' : 'New Item',
            headerLeft: () => (
              <NativeHeaderText label="Cancel" onPress={() => router.back()} />
            ),
            headerRight: () => (
              <NativeHeaderText label="Save" prominent disabled={!canSave} onPress={save} />
            ),
          }}
        />
      ) : null}
      <SafeAreaView style={styles.flex} edges={native ? ['left', 'right'] : ['top', 'left', 'right']}>
        {native ? null : (
          <ScreenBar
            filled
            title={existing ? 'Edit Item' : 'New Item'}
            left={<BarTextButton label="Cancel" onPress={() => router.back()} />}
            right={<BarTextButton label="Save" prominent disabled={!canSave} onPress={save} />}
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
            <Section>
              <Row
                title={photoUris.length > 0 ? 'Add another photo' : 'Photograph the receipt'}
                subtitle={
                  photoUris.length > 0
                    ? undefined
                    : canScan
                      ? 'Covered reads the shop, date and price off it'
                      : 'Proof of purchase — what claims actually need'
                }
                icon="camera"
                onPress={choosePhotoSource}
              />

              {scanning ? (
                <Breathing>
                  <Row
                    title="Reading the receipt…"
                    icon="scan"
                    iconColor="accent"
                    chevron={false}
                    trailing={<ActivityIndicator size="small" />}
                  />
                </Breathing>
              ) : null}

              {!scanning && scanNote ? (
                <Animated.View entering={FadeInDown.duration(Motion.standard)}>
                  <Row title={scanNote} icon="sparkles" iconColor="success" chevron={false} />
                </Animated.View>
              ) : null}
              {photoUris.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.photoRow}>
                  {photoUris.map((uri, index) => (
                    <Pressable
                      key={uri}
                      onPress={() =>
                        void previewAttachment(photoUris, index, () =>
                          isPdf(uri) ? setPdfUri(uri) : setViewerIndex(index),
                        )
                      }
                      onLongPress={() => setPhotoUris((current) => current.filter((p) => p !== uri))}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={
                        isPdf(uri)
                          ? 'PDF. Tap to open, long press to remove.'
                          : 'Photo. Tap to view, long press to remove.'
                      }>
                      {isPdf(uri) ? (
                        <View style={[styles.photo, styles.pdfTile, { backgroundColor: theme.fill }]}>
                          <Ionicons name="document-text" size={26} color={theme.accent} />
                          <ThemedText type="caption" numberOfLines={1} themeColor="textSecondary">
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
            </Section>

            {detected.length > 0 ? (
              <Section
                header="On this receipt"
                footer="One receipt can cover several warranties. Pick the product this item is — you can add the others separately.">
                {detected.map((item) => {
                  const selected = name.trim() === item.description;
                  return (
                    <Row
                      key={`${item.description}-${item.price}`}
                      title={item.description}
                      value={formatPrice(item.price)}
                      icon={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      iconColor={selected ? 'success' : 'textTertiary'}
                      chevron={false}
                      onPress={() => chooseDetected(item)}
                    />
                  );
                })}
              </Section>
            ) : null}

            <Section header="What is it?">
              <InputRow
                value={name}
                onChangeText={setName}
                placeholder="Dishwasher"
                autoFocus={!existing}
                returnKeyType="done"
                onSubmitEditing={save}
              />
            </Section>

            <Section header="Category">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryRow}>
                {CATEGORIES.map((option) => {
                  const selected = option === category;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => chooseCategory(option)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[
                        styles.categoryTile,
                        { backgroundColor: selected ? theme.accent : theme.fill },
                      ]}>
                      <Ionicons
                        name={CATEGORY_ICON[option]}
                        size={20}
                        color={selected ? '#FFFFFF' : theme.textSecondary}
                      />
                      <ThemedText
                        type="caption"
                        numberOfLines={1}
                        style={{ color: selected ? '#FFFFFF' : theme.textSecondary }}>
                        {option}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Section>

            <Section
              header="Covered for"
              footer={`${boughtToday ? 'Bought today' : `Bought ${formatDate(purchaseDate)}`} · cover ends ${formatDate(expiry)}`}>
              <View style={styles.lengthRow}>
                {LENGTH_PRESETS.map((months) => {
                  const selected = months === warrantyMonths;
                  return (
                    <Pressable
                      key={months}
                      onPress={() => {
                        if (Platform.OS !== 'web') Haptics.selectionAsync();
                        setWarrantyDays(undefined);
                        setWarrantyMonths(months);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[
                        styles.lengthChip,
                        { backgroundColor: selected ? theme.accent : theme.fill },
                      ]}>
                      <ThemedText
                        type="footnote"
                        style={{ color: selected ? '#FFFFFF' : theme.text, fontWeight: '600' }}>
                        {lengthLabel(months)}
                      </ThemedText>
                    </Pressable>
                  );
                })}

                <Pressable
                  onPress={() => setCustomOpen(true)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: warrantyDays !== undefined }}
                  style={[
                    styles.lengthChip,
                    { backgroundColor: warrantyDays !== undefined ? theme.accent : theme.fill },
                  ]}>
                  <ThemedText
                    type="footnote"
                    style={{
                      color: warrantyDays !== undefined ? '#FFFFFF' : theme.text,
                      fontWeight: '600',
                    }}>
                    Custom
                  </ThemedText>
                </Pressable>
              </View>
            </Section>

            <Section>
              <Row
                title={showMore ? 'Hide extra details' : 'Add extra details'}
                subtitle={showMore ? undefined : 'Brand, shop, price, serial — all optional'}
                icon={showMore ? 'chevron-up' : 'options'}
                iconColor="textSecondary"
                onPress={toggleMore}
                chevron={false}
              />
            </Section>

            {showMore ? (
              <>
                <Section header="Where it came from">
                  <InputRow label="Brand" value={brand} onChangeText={setBrand} placeholder="Bosch" />
                  <InputRow label="Shop" value={retailer} onChangeText={setRetailer} placeholder="Currys" />
                  {Platform.OS === 'ios' ? (
                    <View style={styles.dateRow}>
                      <ThemedText type="body">Purchased</ThemedText>
                      <DateTimePicker
                        value={purchaseDate}
                        mode="date"
                        display="compact"
                        maximumDate={new Date()}
                        onChange={(_, date) => date && setPurchaseDate(date)}
                      />
                    </View>
                  ) : (
                    <>
                      <Row
                        title="Purchased"
                        value={formatDate(purchaseDate)}
                        onPress={() => setShowDatePicker(true)}
                        chevron={false}
                      />
                      {showDatePicker && (
                        <DateTimePicker
                          value={purchaseDate}
                          mode="date"
                          maximumDate={new Date()}
                          onChange={(_, date) => {
                            setShowDatePicker(false);
                            if (date) setPurchaseDate(date);
                          }}
                        />
                      )}
                    </>
                  )}
                </Section>

                <Section header="Paperwork">
                  <InputRow
                    label="Price"
                    value={price}
                    onChangeText={setPrice}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                  />
                  <InputRow
                    label="Serial"
                    value={serialNumber}
                    onChangeText={setSerialNumber}
                    placeholder="Optional"
                    autoCapitalize="characters"
                  />
                  <InputRow
                    label="Claim link"
                    value={claimUrl}
                    onChangeText={setClaimUrl}
                    placeholder="https://"
                    autoCapitalize="none"
                    keyboardType="url"
                  />
                </Section>

                <Section header="Notes">
                  <InputRow
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Extended cover, where the receipt is filed…"
                    multiline
                  />
                </Section>
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <CustomWarrantySheet
          visible={customOpen}
          onClose={() => setCustomOpen(false)}
          onConfirm={applyCustomWarranty}
        />

        <UpsellSheet
          reason={upsell}
          onClose={() => {
            const wasMagic = upsell === 'magic';
            setUpsell(null);
            if (wasMagic) router.back();
          }}
        />

        <PdfViewer uri={pdfUri} visible={pdfUri !== null} onClose={() => setPdfUri(null)} />

        <PhotoViewer
          uris={photoUris.filter((uri) => !isPdf(uri))}
          initialIndex={viewerIndex ?? 0}
          visible={viewerIndex !== null}
          onClose={() => setViewerIndex(null)}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingTop: Spacing.four, paddingBottom: Spacing.six },
  photoRow: { gap: Spacing.two, padding: ListMetrics.horizontalInset },
  photo: { width: 76, height: 76, borderRadius: Radius.sm },
  pdfTile: { alignItems: 'center', justifyContent: 'center', gap: 2, padding: Spacing.one },
  categoryRow: { gap: Spacing.two, padding: Spacing.two + 4 },
  categoryTile: {
    width: 78,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
    alignItems: 'center',
    gap: Spacing.one,
  },
  lengthRow: {
    flexDirection: 'row',
    gap: Spacing.two - 2,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two + 4,
  },
  lengthChip: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    alignItems: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: ListMetrics.rowHeight,
    paddingHorizontal: ListMetrics.horizontalInset,
    paddingVertical: Spacing.two,
  },
});
