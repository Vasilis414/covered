import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { SlideInDown, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { SheetBackdrop } from '@/components/ui/sheet-backdrop';
import { Motion } from '@/constants/motion';
import { ListMetrics, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/store/auth';
import {
  DEFAULT_PRICES,
  fetchLivePrices,
  type PlanTier,
  purchaseProductById,
  restorePurchases,
} from '@/lib/subscriptions';

const TIERS: PlanTier[] = ['yearly', 'sixMonth', 'threeMonth', 'monthly'];

export function PaywallModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { setEntitlement } = useAuth();
  const [selectedTier, setSelectedTier] = useState<PlanTier>('yearly');
  const [loading, setLoading] = useState(false);

  /**
   * Real store prices, in the user's own currency. Until they arrive the
   * card falls back to DEFAULT_PRICES, so the sheet is never blank — but
   * whatever the store says always wins.
   */
  const [livePrices, setLivePrices] = useState<Partial<Record<PlanTier, string>>>({});

  useEffect(() => {
    if (!visible) return;
    let active = true;
    fetchLivePrices().then((prices) => {
      if (active) setLivePrices(prices);
    });
    return () => {
      active = false;
    };
  }, [visible]);

  function priceFor(tier: PlanTier): string {
    return livePrices[tier] ?? DEFAULT_PRICES[tier].price;
  }

  const selectedPlan = DEFAULT_PRICES[selectedTier];

  async function handlePurchase() {
    setLoading(true);
    try {
      const res = await purchaseProductById(selectedTier);
      if (res.success) {
        // Merge: plan, expiresAt and scansUsed belong to the server's record
        // and must not be clobbered by a local purchase result.
        setEntitlement((current) => ({
          ...(current ?? { plan: 'pro', expiresAt: null, scansUsed: 0 }),
          paid: true,
          storageLimit: 500 * 1024 * 1024,
          storageUsed: current?.storageUsed ?? 0,
          scansRemaining: null,
          accountDeleted: false,
        }));
        Alert.alert('Welcome to Covered Pro!', 'Your subscription is now active.');
        onClose();
      } else if (!res.userCancelled) {
        Alert.alert('Purchase Pending', 'Please ensure in-app purchases are enabled for your Apple ID.');
      }
    } catch (e) {
      console.warn('Purchase error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore() {
    setLoading(true);
    try {
      const res = await restorePurchases();
      if (res.success) {
        // Merge: plan, expiresAt and scansUsed belong to the server's record
        // and must not be clobbered by a local purchase result.
        setEntitlement((current) => ({
          ...(current ?? { plan: 'pro', expiresAt: null, scansUsed: 0 }),
          paid: true,
          storageLimit: 500 * 1024 * 1024,
          storageUsed: current?.storageUsed ?? 0,
          scansRemaining: null,
          accountDeleted: false,
        }));
        Alert.alert('Purchases Restored', 'Your Pro access has been restored.');
        onClose();
      } else {
        Alert.alert('No Subscription Found', 'No active subscription was found for this Apple ID.');
      }
    } catch (e) {
      console.warn('Restore error:', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetBackdrop onPress={onClose} />
        <Animated.View
          entering={reduceMotion ? undefined : SlideInDown.duration(Motion.standard)}
          style={[styles.sheet, { backgroundColor: theme.card }]}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Crown Header Badge */}
            <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="sparkles" size={28} color={theme.accent} />
            </View>

            <ThemedText type="title" style={styles.title}>
              Covered Pro
            </ThemedText>
            <ThemedText type="subhead" themeColor="textSecondary" style={styles.subtitle}>
              Unlock unlimited AI scanning, unlimited items vault, and automatic cloud backups.
            </ThemedText>

            {/* Plan Selector Grid */}
            <View style={styles.plansContainer}>
              {TIERS.map((tier) => {
                const plan = DEFAULT_PRICES[tier];
                const isSelected = selectedTier === tier;
                return (
                  <Pressable
                    key={tier}
                    onPress={() => setSelectedTier(tier)}
                    style={[
                      styles.planCard,
                      {
                        backgroundColor: isSelected ? theme.accentSoft : theme.fill,
                        borderColor: isSelected ? theme.accent : theme.separator,
                      },
                    ]}>
                    <View style={styles.planLeft}>
                      <View style={styles.planTitleRow}>
                        <ThemedText type="headline">{plan.title}</ThemedText>
                        {plan.badge ? (
                          <View
                            style={[
                              styles.planBadge,
                              { backgroundColor: isSelected ? theme.accent : theme.textSecondary },
                            ]}>
                            <ThemedText style={styles.planBadgeText}>{plan.badge}</ThemedText>
                          </View>
                        ) : null}
                      </View>
                      <ThemedText type="footnote" themeColor="textSecondary">
                        Auto-renews until cancelled
                      </ThemedText>
                    </View>

                    <View style={styles.planRight}>
                      <ThemedText type="headline" style={{ color: theme.accent }}>
                        {priceFor(tier)}
                      </ThemedText>
                      <ThemedText type="caption" themeColor="textSecondary">
                        {plan.period}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Subscribe Button */}
            <Pressable
              onPress={handlePurchase}
              disabled={loading}
              style={[
                styles.subscribeButton,
                { backgroundColor: theme.accent, opacity: loading ? 0.7 : 1 },
              ]}>
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText style={styles.subscribeButtonText}>
                  Subscribe for {priceFor(selectedTier)}
                </ThemedText>
              )}
            </Pressable>

            {/* Restore & Dismiss */}
            <View style={styles.footerRow}>
              <Pressable onPress={handleRestore} disabled={loading} style={styles.footerButton}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Restore Purchases
                </ThemedText>
              </Pressable>
              <ThemedText type="footnote" themeColor="textTertiary">
                •
              </ThemedText>
              <Pressable onPress={onClose} style={styles.footerButton}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Not now
                </ThemedText>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  content: {
    alignItems: 'center',
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  badge: {
    width: 60,
    height: 60,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  title: { textAlign: 'center', fontWeight: 'bold' },
  subtitle: { textAlign: 'center', paddingHorizontal: Spacing.three, marginBottom: Spacing.two },
  plansContainer: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginVertical: Spacing.two,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: ListMetrics.horizontalInset,
    borderRadius: Radius.md,
    borderWidth: 1.5,
  },
  planLeft: { gap: 2 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  planBadge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  planBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  planRight: { alignItems: 'flex-end' },
  subscribeButton: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  subscribeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  footerButton: {
    paddingVertical: Spacing.one,
  },
});
