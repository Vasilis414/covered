import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassRadius } from '@/constants/design';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The receipt capture, given the weight it actually carries.
 *
 * This was a list row with a chevron, visually identical to "Add extra
 * details" — so the one thing that distinguishes Covered from a note looked
 * like a settings entry. It is the fast path through the whole form: a
 * photograph fills in the shop, date, price and product, and everything below
 * becomes a review rather than data entry.
 *
 * Deliberately not a GlassCard. It sits inside the form's flat ground where
 * glass has nothing to sample, and a dashed capture target reads as "put
 * something here" in a way a filled card does not.
 */
export function CaptureCard({
  onPress,
  hasPhotos,
  canScan,
  scanning,
}: {
  onPress: () => void;
  hasPhotos: boolean;
  canScan: boolean;
  scanning: boolean;
}) {
  const theme = useTheme();

  /** Once something is attached this stops being the hero and becomes an add button. */
  if (hasPhotos) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add another photo"
        onPress={onPress}
        disabled={scanning}
        style={({ pressed }) => [
          styles.compact,
          {
            borderColor: theme.separator,
            backgroundColor: theme.fill,
            opacity: pressed ? 0.7 : 1,
          },
        ]}>
        <Ionicons name="add" size={18} color={theme.accent} />
        <ThemedText type="callout" style={{ color: theme.accent, fontWeight: '600' }}>
          Add another photo
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Photograph the receipt"
      onPress={onPress}
      disabled={scanning}
      style={({ pressed }) => [
        styles.hero,
        {
          borderColor: scanning ? theme.accent : theme.separator,
          backgroundColor: theme.fill,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
        {scanning ? (
          <ActivityIndicator size="small" color={theme.accent} />
        ) : (
          <Ionicons name="camera" size={26} color={theme.accent} />
        )}
      </View>

      <ThemedText type="headline" style={styles.title}>
        {scanning ? 'Reading the receipt…' : 'Photograph the receipt'}
      </ThemedText>

      <ThemedText type="footnote" themeColor="textSecondary" style={styles.body}>
        {scanning
          ? 'This takes a few seconds.'
          : canScan
            ? 'Covered fills in the shop, date and price for you.'
            : 'Proof of purchase — what a claim actually needs.'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    marginHorizontal: Spacing.four,
    borderRadius: GlassRadius.card,
    /**
     * Dashed, and only here.
     *
     * It reads as an empty slot waiting to be filled rather than a button, and
     * nothing else in the app uses this treatment — so it stays unambiguous.
     */
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two + 2,
    marginHorizontal: Spacing.four,
    borderRadius: GlassRadius.control,
    borderWidth: 1,
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', paddingHorizontal: Spacing.two },
});
