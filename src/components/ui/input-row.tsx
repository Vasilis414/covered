import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ListMetrics, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A text field shaped like an iOS form row: optional label on the left, the
 * input filling the rest. Sits inside a <Section> alongside normal rows.
 */
export function InputRow({
  label,
  style,
  multiline,
  ...rest
}: TextInputProps & { label?: string }) {
  const theme = useTheme();

  return (
    <View style={[styles.row, multiline && styles.rowMultiline]}>
      {label ? (
        <ThemedText type="body" style={styles.label} numberOfLines={1}>
          {label}
        </ThemedText>
      ) : null}
      <TextInput
        placeholderTextColor={theme.textSecondary}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline, { color: theme.text }, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ListMetrics.rowHeight,
    paddingHorizontal: ListMetrics.horizontalInset,
    gap: Spacing.two,
  },
  rowMultiline: { alignItems: 'flex-start', paddingVertical: Spacing.two + 3 },
  label: { width: 104 },
  input: {
    flex: 1,
    fontSize: 17,
    letterSpacing: -0.41,
    paddingVertical: Spacing.two + 3,
  },
  inputMultiline: {
    minHeight: 76,
    textAlignVertical: 'top',
    paddingTop: 0,
  },
});
