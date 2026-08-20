import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { SlideInDown, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { SheetBackdrop } from '@/components/ui/sheet-backdrop';
import { GlassButton } from '@/components/ui/glass-button';
import { Motion } from '@/constants/motion';
import { ListMetrics, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/store/auth';
import { PaywallModal } from '@/components/paywall-modal';
import { openPaywall } from '@/lib/open-paywall';

export type UpsellReason = 'items' | 'scan' | 'scan-intro' | 'magic' | 'backup' | 'signin' | null;

const COPY: Record<Exclude<UpsellReason, null | 'signin'>, { title: string; body: string }> = {
  items: {
    title: 'Room for more',
    body: 'The free plan holds five items. Premium tracks everything you own.',
  },
  magic: {
    title: 'Magic, right?',
    body: 'Covered read that receipt and filled the whole thing in — no typing. That was your free scan; Premium does it for every receipt.',
  },
  'scan-intro': {
    title: 'That was your free AI scan',
    body: 'Covered read the shop, date, price and every product straight off the receipt. Premium does that for every receipt you add.',
  },
  scan: {
    title: 'AI scanning is a Premium feature',
    body: 'Upgrade and Covered fills the form in for you — shop, date, price and each product — from a photo.',
  },
  backup: {
    title: 'Keep your receipts safe',
    body: 'Premium keeps your items and receipt photos backed up, so a lost phone is not a lost record.',
  },
};

const PREMIUM_BENEFITS = [
  { icon: 'sparkles', text: 'Unlimited AI receipt scanning' },
  { icon: 'infinite', text: 'Unlimited items' },
  { icon: 'cloud-done', text: 'Automatic backup of items and receipts' },
] as const;

/**
 * What signing in actually gets you. Listing the premium benefits above a
 * "Sign in with Google" button implied signing in granted them — it doesn't,
 * and finding that out after the fact is a bad first impression.
 */
const FREE_BENEFITS = [
  { icon: 'cube-outline', text: 'Track up to 5 items' },
  { icon: 'notifications-outline', text: 'Reminders before cover ends' },
  { icon: 'sparkles-outline', text: 'One free AI receipt scan to try' },
] as const;

/**
 * Shown at the moment a limit is hit, rather than as a nag on launch — that's
 * when someone has just felt the value and is most likely to care.
 */
export function UpsellSheet({
  reason,
  onClose,
}: {
  reason: UpsellReason;
  onClose: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { signedIn, signIn, signingIn } = useAuth();
  const copy = reason && reason !== 'signin' ? COPY[reason] : null;

  /**
   * Signing in closes the sheet instead of re-dressing it as a Premium pitch.
   *
   * The sheet reads `signedIn` live, so completing a sign-in used to swap the
   * title, the benefits and the button underneath the user the instant it
   * succeeded — an upsell arriving as the reward for doing what was asked. If
   * they hit a paid limit later, that moment will ask for itself.
   */
  const [showPaywall, setShowPaywall] = useState(false);
  const [pendingPaywall, setPendingPaywall] = useState(false);
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    if (reason !== null && signedIn && !wasSignedIn.current) onClose();
    wasSignedIn.current = signedIn;
  }, [signedIn, reason, onClose]);
  // Signed out, this is a sign-in prompt — not a sales pitch for Premium.
  const promptingSignIn = !signedIn;
  const benefits = promptingSignIn ? FREE_BENEFITS : PREMIUM_BENEFITS;

  return (
    <>
      <PaywallModal
        visible={showPaywall}
        onClose={() => {
          setShowPaywall(false);
          onClose();
        }}
      />
      <Modal
        visible={reason !== null && !showPaywall}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        onDismiss={() => {
          if (!pendingPaywall) return;
          setPendingPaywall(false);
          void openPaywall().then(({ needsFallback }) => {
            if (needsFallback) setShowPaywall(true);
          });
        }}>
        <View style={styles.root}>
          <SheetBackdrop onPress={onClose} />
          <Animated.View
            entering={reduceMotion ? undefined : SlideInDown.duration(Motion.standard)}
            style={[styles.sheet, { backgroundColor: theme.card }]}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="shield-checkmark" size={26} color={theme.accent} />
            </View>

            <ThemedText type="title3" style={styles.title}>
              {promptingSignIn ? 'Welcome to Covered' : (copy?.title ?? 'Covered Premium')}
            </ThemedText>
            <ThemedText type="subhead" themeColor="textSecondary" style={styles.body}>
              {promptingSignIn
                ? 'Sign in to create your free account. Your items stay on this phone either way.'
                : (copy?.body ?? '')}
            </ThemedText>

            <View style={styles.benefits}>
              {benefits.map((benefit) => (
                <View key={benefit.text} style={styles.benefit}>
                  <Ionicons name={benefit.icon} size={18} color={theme.success} />
                  <ThemedText type="callout" style={styles.benefitText}>
                    {benefit.text}
                  </ThemedText>
                </View>
              ))}
            </View>

            {signedIn ? (
              <>
                <GlassButton
                  label="Subscribe"
                  onPress={() => {
                    /**
                     * Present only once this sheet has actually gone.
                     *
                     * Closing and presenting in the same tick raced the Modal's
                     * dismissal: iOS put the paywall on top of a modal window
                     * that was still tearing down, and when the paywall closed
                     * that invisible window stayed key and swallowed every
                     * touch, leaving buttons dead until the screen was
                     * remounted. onDismiss fires after the window is really
                     * gone, so there is nothing left to present over.
                     */
                    setPendingPaywall(true);
                    onClose();
                  }}
                />
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.body}>
                  Unlock unlimited AI receipt scans, items and cloud backup.
                </ThemedText>
              </>
            ) : (
              <>
                <GlassButton
                  label={signingIn ? 'Opening Google…' : 'Sign in with Google'}
                  disabled={signingIn}
                  onPress={() => signIn()}
                />
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.body}>
                  Premium is a separate upgrade — unlimited scanning, unlimited items and backup.
                </ThemedText>
              </>
            )}

            <Pressable accessibilityRole="button" onPress={onClose} style={styles.dismiss}>
              <ThemedText type="callout" themeColor="textSecondary">
                {promptingSignIn ? 'Maybe later' : 'Not now'}
              </ThemedText>
            </Pressable>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  /**
   * A dedicated container pins the sheet, rather than a flex:1 backdrop
   * pushing it down.
   *
   * The old arrangement relied on the backdrop being a flex sibling. A
   * reanimated `entering` animation takes the sheet out of normal flow while
   * it runs, which left it at the top of the screen with its height measured
   * against the wrong box. justifyContent does the anchoring here, so the
   * animation cannot move it, and overflow:hidden keeps the content inside
   * the card instead of painting over the app behind it.
   */
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  content: {
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
  title: { textAlign: 'center' },
  body: { textAlign: 'center', paddingHorizontal: Spacing.two },
  benefits: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginVertical: Spacing.three,
    paddingHorizontal: ListMetrics.horizontalInset,
  },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  benefitText: { flex: 1 },
  dismiss: { paddingVertical: Spacing.two },
});
