import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassRadius } from '@/constants/design';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * When the cover ends, stated as a result rather than a caption.
 *
 * This was the footer text under the length chips — the same grey as every
 * other hint on the screen. But it is the answer the form exists to produce:
 * someone picks "2 yr" to find out what date that lands on, and the date is
 * what they will be reminded about. Giving it a surface of its own makes the
 * consequence of the choice above it legible at a glance.
 */
export function CoverSummary({
  boughtLabel,
  expiryLabel,
}: {
  boughtLabel: string;
  expiryLabel: string;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.accentSoft, borderColor: theme.accent },
      ]}>
      <Ionicons name="shield-checkmark" size={20} color={theme.accent} />
      <View style={styles.text}>
        <ThemedText type="footnote" themeColor="textSecondary">
          {boughtLabel}
        </ThemedText>
        <ThemedText type="callout" style={{ color: theme.accent, fontWeight: '600' }}>
          Covered until {expiryLabel}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    marginHorizontal: Spacing.four,
    /**
     * Pulled up against the length chips, pushed away from what follows.
     *
     * Section already contributes 24pt below itself, so adding a top margin
     * here left 32pt of void above and nothing below — the summary floated
     * away from the choice it describes and collided with the next row. The
     * negative closes that gap to 8pt so it reads as the result of the control
     * above it, and the bottom margin restores the normal section rhythm.
     */
    marginTop: -Spacing.three,
    marginBottom: Spacing.four,
    borderRadius: GlassRadius.control,
    // Hairline rather than a full border: it should read as a raised note, not
    // as another input the user is meant to act on.
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 1 },
});
