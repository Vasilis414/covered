import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/**
 * A trailing nav-bar button. Deliberately a bare symbol with no background:
 * on iOS 26 the nav bar supplies the glass, so a button drawing its own
 * material ends up as glass on glass.
 */
export function NativeHeaderAction({
  symbol,
  label,
  onPress,
}: {
  symbol: SFSymbol;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      style={styles.button}>
      <SymbolView name={symbol} size={22} tintColor={String(theme.accent)} />
    </Pressable>
  );
}

/** The text equivalent — "Cancel", "Save" — centred on the same bar row. */
export function NativeHeaderText({
  label,
  onPress,
  disabled,
  prominent,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  prominent?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      hitSlop={12}
      style={styles.text}>
      <ThemedText
        type={prominent ? 'headline' : 'body'}
        style={{ color: disabled ? theme.textTertiary : theme.accent }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * No fixed height. iOS 26 wraps a bar button in its own glass capsule and
   * sizes that capsule to the content, so forcing 44pt here inflated the
   * capsule instead of moving the glyph — which is what made the `+` read as
   * a large blob floating high above the title.
   */
  button: { alignItems: 'center', justifyContent: 'center' },
  text: { justifyContent: 'center' },
});
