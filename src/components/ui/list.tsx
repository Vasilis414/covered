import { Ionicons } from '@expo/vector-icons';
import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ListMetrics, Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { GlassRadius } from '@/constants/design';
import { GlassCard } from '@/components/ui/glass-card';
import { useTheme } from '@/hooks/use-theme';

/**
 * An inset grouped list section — the white rounded card with a quiet uppercase
 * header that iOS uses everywhere from Settings to Mail.
 */
export function Section({
  header,
  footer,
  children,
  style,
}: {
  header?: string;
  footer?: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(Boolean);

  return (
    <View style={[styles.section, style]}>
      {header ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.header}>
          {header.toUpperCase()}
        </ThemedText>
      ) : null}

      <GlassCard radius={GlassRadius.row} style={styles.card}>
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 && (
              <View style={[styles.separator, { backgroundColor: theme.separator }]} />
            )}
            {row}
          </Fragment>
        ))}
      </GlassCard>

      {footer ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.footer}>
          {footer}
        </ThemedText>
      ) : null}
    </View>
  );
}

export type RowProps = {
  title: string;
  subtitle?: string;
  /** Right-aligned secondary text, as in Settings. */
  value?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: ThemeColor;
  /** Custom trailing content — a switch, a pill, anything. */
  trailing?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  /** Centres the title and drops the icon, for standalone action rows. */
  centered?: boolean;
};

export function Row({
  title,
  subtitle,
  value,
  icon,
  iconColor = 'accent',
  trailing,
  onPress,
  chevron,
  destructive,
  centered,
}: RowProps) {
  const theme = useTheme();
  const showChevron = chevron ?? Boolean(onPress && !trailing);

  const content = (
    <>
      {icon && !centered ? (
        <View style={[styles.iconTile, { backgroundColor: theme[iconColor] }]}>
          <Ionicons name={icon} size={17} color="#FFFFFF" />
        </View>
      ) : null}

      <View style={[styles.labels, centered && styles.labelsCentered]}>
        <ThemedText
          type={centered ? 'callout' : 'body'}
          style={[destructive && { color: theme.danger }, centered && styles.centeredText]}
          numberOfLines={centered ? 1 : 2}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>

      {value ? (
        <ThemedText type="body" themeColor="textSecondary" numberOfLines={1} style={styles.value}>
          {value}
        </ThemedText>
      ) : null}

      {trailing}

      {showChevron ? (
        <Ionicons name="chevron-forward" size={17} color={theme.textTertiary} />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardPressed }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: Spacing.four },
  header: {
    marginLeft: ListMetrics.horizontalInset + Spacing.one,
    marginBottom: Spacing.two - 1,
    letterSpacing: 0.5,
  },
  footer: {
    marginHorizontal: ListMetrics.horizontalInset + Spacing.one,
    marginTop: Spacing.two - 1,
  },
  card: {
    marginHorizontal: ListMetrics.horizontalInset,
    // GlassCard applies the radius and its own padding; rows bring theirs.
    padding: 0,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: ListMetrics.horizontalInset,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ListMetrics.rowHeight,
    paddingHorizontal: ListMetrics.horizontalInset,
    paddingVertical: Spacing.two + 3,
    gap: Spacing.two + 4,
  },
  iconTile: {
    width: 29,
    height: 29,
    borderRadius: 6.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labels: { flex: 1, gap: 1 },
  labelsCentered: { alignItems: 'center' },
  centeredText: { textAlign: 'center' },
  value: { flexShrink: 1, textAlign: 'right' },
});
