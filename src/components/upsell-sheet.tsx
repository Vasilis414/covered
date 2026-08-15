import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { SlideInDown, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Motion } from '@/constants/motion';
import { ListMetrics, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/store/auth';

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
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    if (reason !== null && signedIn && !wasSignedIn.current) onClose();
    wasSignedIn.current = signedIn;
  }, [signedIn, reason, onClose]);
  // Signed out, this is a sign-in prompt — not a sales pitch for Premium.
  const promptingSignIn = !signedIn;
  const benefits = promptingSignIn ? FREE_BENEFITS : PREMIUM_BENEFITS;

  return (
    /* The modal fades so the backdrop appears in place; only the card travels.
       Sliding the whole modal dragged the dim layer up from the bottom edge
       with it, which read as one grey panel rather than a sheet over the app. */
    <Modal visible={reason !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
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
              <PressableScale
                accessibilityRole="button"
                style={[styles.primary, { backgroundColor: theme.accent }]}
                onPress={onClose}>
                <ThemedText type="headline" style={styles.primaryLabel}>
                  Subscribe
                </ThemedText>
              </PressableScale>
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.body}>
                Subscriptions aren&apos;t open yet — have a code? Settings, then tap Version.
              </ThemedText>
            </>
          ) : (
            <>
              <PressableScale
                accessibilityRole="button"
                disabled={signingIn}
                style={[styles.primary, { backgroundColor: theme.accent }]}
                onPress={() => signIn()}>
                <ThemedText type="headline" style={styles.primaryLabel}>
                  {signingIn ? 'Opening Google…' : 'Sign in with Google'}
                </ThemedText>
              </PressableScale>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    maxHeight: '80%',
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
  primary: {
    alignSelf: 'stretch',
    height: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { color: '#FFFFFF' },
  dismiss: { paddingVertical: Spacing.two },
});
