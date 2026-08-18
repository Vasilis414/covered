import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { SlideInDown, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Motion } from '@/constants/motion';
import { ListMetrics, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isPdf } from '@/lib/attachments';

/**
 * Asks whether an incoming file is a warranty item or a Storage Room item, then
 * routes to the matching add screen with the file attached.
 *
 * The question has to be asked, because the two are different records: a
 * warranty item gets a purchase date, a cover length and reminders, while a
 * storage item gets a barcode and an expiry. Guessing wrong would put the file
 * in the wrong place and cost the user more than a tap.
 *
 * The file can arrive two ways — the OS share sheet (native, needs the signed
 * share extension) or an in-app picker — so this component is deliberately
 * agnostic: it takes a path and does not care where it came from.
 */
export function DestinationChooser({
  filePath,
  onClose,
}: {
  filePath: string | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const visible = Boolean(filePath);

  function open(destination: '/add' | '/storage-add') {
    if (!filePath) return;
    // Close first: leaving it open would re-stack this sheet over the screen
    // we are navigating to.
    onClose();
    router.push({ pathname: destination, params: { shared: filePath } });
  }

  const kind = filePath && isPdf(filePath) ? 'document' : 'photo';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View
          entering={reduceMotion ? undefined : SlideInDown.duration(Motion.standard)}
          style={[styles.sheet, { backgroundColor: theme.card }]}>
          <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
            <Ionicons
              name={kind === 'document' ? 'document-text' : 'image'}
              size={26}
              color={theme.accent}
            />
          </View>

          <ThemedText type="title3" style={styles.centre}>
            Where should this go?
          </ThemedText>
          <ThemedText type="subhead" themeColor="textSecondary" style={styles.centre}>
            Your {kind} will be attached and read automatically.
          </ThemedText>

          <View style={styles.choices}>
            <Pressable
              accessibilityRole="button"
              onPress={() => open('/add')}
              style={({ pressed }) => [
                styles.choice,
                { borderColor: theme.separator, opacity: pressed ? 0.7 : 1 },
              ]}>
              <Ionicons name="shield-checkmark" size={22} color={theme.accent} />
              <View style={styles.choiceText}>
                <ThemedText type="headline">Warranty item</ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  A receipt for something you own
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={17} color={theme.textTertiary} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => open('/storage-add')}
              style={({ pressed }) => [
                styles.choice,
                { borderColor: theme.separator, opacity: pressed ? 0.7 : 1 },
              ]}>
              <Ionicons name="albums" size={22} color={theme.accent} />
              <View style={styles.choiceText}>
                <ThemedText type="headline">Storage Room</ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  A ticket, pass or card
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={17} color={theme.textTertiary} />
            </Pressable>
          </View>

          <Pressable accessibilityRole="button" onPress={onClose} style={styles.dismiss}>
            <ThemedText type="callout" themeColor="textSecondary">
              Cancel
            </ThemedText>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // A container pins the sheet so the reanimated entrance cannot move it.
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    maxHeight: '80%',
    overflow: 'hidden',
    alignItems: 'center',
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  centre: { textAlign: 'center', paddingHorizontal: Spacing.two },
  choices: { alignSelf: 'stretch', gap: Spacing.two, marginTop: Spacing.three },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: ListMetrics.horizontalInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
  },
  choiceText: { flex: 1, gap: 1 },
  dismiss: { paddingVertical: Spacing.two, marginTop: Spacing.one },
});
