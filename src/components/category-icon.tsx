import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { WarrantyStatus } from '@/lib/warranty';
import type { Category } from '@/types/item';

export const CATEGORY_ICON: Record<Category, keyof typeof Ionicons.glyphMap> = {
  Electronics: 'phone-portrait',
  Appliance: 'cube',
  Furniture: 'bed',
  Vehicle: 'car-sport',
  Tools: 'construct',
  Other: 'pricetag',
};

const STATUS_COLOR = {
  active: 'success',
  expiring: 'warning',
  expired: 'danger',
} as const satisfies Record<WarrantyStatus, string>;

/** Rounded-square glyph tile, tinted by how much cover is left. */
export function CategoryIcon({
  category,
  status,
  size = 38,
}: {
  category: Category;
  status: WarrantyStatus;
  size?: number;
}) {
  const theme = useTheme();
  const tone = STATUS_COLOR[status];

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size / 3.4,
          backgroundColor: theme[`${tone}Soft`],
        },
      ]}>
      <Ionicons name={CATEGORY_ICON[category]} size={size * 0.52} color={theme[tone]} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
});
