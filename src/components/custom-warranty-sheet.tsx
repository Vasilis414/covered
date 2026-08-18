import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { SheetBackdrop } from '@/components/ui/sheet-backdrop';
import { WheelPicker } from '@/components/ui/wheel-picker';
import { ListMetrics, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const AMOUNTS = Array.from({ length: 365 }, (_, index) => index + 1);
const UNITS = ['days', 'weeks', 'months', 'years'] as const;

export type WarrantyUnit = (typeof UNITS)[number];

export type CustomWarranty =
  | { kind: 'months'; months: number }
  | { kind: 'days'; days: number };

/** Days and weeks stay exact; months and years use calendar arithmetic. */
export function toCustomWarranty(amount: number, unit: WarrantyUnit): CustomWarranty {
  if (unit === 'days') return { kind: 'days', days: amount };
  if (unit === 'weeks') return { kind: 'days', days: amount * 7 };
  if (unit === 'years') return { kind: 'months', months: amount * 12 };
  return { kind: 'months', months: amount };
}

export function CustomWarrantySheet({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (result: CustomWarranty, label: string) => void;
}) {
  const theme = useTheme();
  const [amount, setAmount] = useState(30);
  const [unit, setUnit] = useState<WarrantyUnit>('days');

  function confirm() {
    const label = `${amount} ${amount === 1 ? unit.slice(0, -1) : unit}`;
    onConfirm(toCustomWarranty(amount, unit), label);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/*
        The sheet is pinned to the bottom by this container, not by the
        backdrop. The old backdrop was a `flex: 1` sibling doing that job by
        side effect, so when it became an absolutely positioned blur the sheet
        lost its spacer and slid up under the status bar.
      */}
      <View style={styles.root}>
        <SheetBackdrop onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.card }]}>
          <View style={[styles.header, { borderBottomColor: theme.separator }]}>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
              <ThemedText type="body" style={{ color: theme.accent }}>
                Cancel
              </ThemedText>
            </Pressable>
            <ThemedText type="headline">Custom cover</ThemedText>
            <Pressable onPress={confirm} hitSlop={12} accessibilityRole="button">
              <ThemedText type="headline" style={{ color: theme.accent }}>
                Set
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.wheels}>
            <WheelPicker values={AMOUNTS} value={amount} onChange={setAmount} />
            <WheelPicker values={UNITS} value={unit} onChange={setUnit} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.six,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ListMetrics.horizontalInset,
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wheels: { flexDirection: 'row', paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
});
