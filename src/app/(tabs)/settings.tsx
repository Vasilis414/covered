import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UpsellSheet, type UpsellReason } from '@/components/upsell-sheet';
import { LargeTitleScreen } from '@/components/ui/large-title-screen';
import { Row, Section } from '@/components/ui/list';
import { Segmented } from '@/components/ui/segmented';
import { ACCENT_NAMES, Accents, ListMetrics, Radius, Spacing, type Appearance } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { isAiAvailable } from '@/lib/ai-receipt';
import { formatPrice, statusOf } from '@/lib/warranty';
import { useAuth } from '@/store/auth';
import { useItems } from '@/store/items';
import { useStorage } from '@/store/storage';
import { useBackup } from '@/store/backup';
import { deleteAccount } from '@/lib/api';
import { AVAILABLE_OFFSETS, useSettings } from '@/store/settings';
import { FREE_ITEM_LIMIT } from '@/lib/limits';
import {
  presentCustomerCenter,
  restorePurchases,
} from '@/lib/subscriptions';
import { PaywallModal } from '@/components/paywall-modal';
import { openPaywall } from '@/lib/open-paywall';

const APPEARANCES: { value: Appearance; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'system', label: 'Match device', icon: 'contrast' },
  { value: 'light', label: 'Light', icon: 'sunny' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { items, rescheduleAll, clearAll } = useItems();
  const { clearAllStorage } = useStorage();
  const { lastBackupAt, status: backupStatus, message: backupNote, backupNow, restoreNow } = useBackup();
  const {
    reminderOffsets,
    appearance,
    accent,
    toggleOffset,
    setAppearance,
    setAccent,
    googleBackupDestination,
    setGoogleBackupDestination,
  } = useSettings();
  const { signedIn, entitlement, signingIn, signIn, signInWithPlenum, signInWithApple, appleAvailable, signOut, getIdToken, refresh, authProvider } =
    useAuth();
  const [busy, setBusy] = useState(false);
  // Mirrors the rule in store/backup: only Google can reach Drive.
  const useCloud =
    authProvider === 'plenum' ||
    authProvider === 'apple' ||
    (authProvider === 'google' && googleBackupDestination === 'cloud');


  // Tapping the version row a few times reveals the code field.
  const [upsell, setUpsell] = useState<UpsellReason>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const premium = Boolean(entitlement?.paid);

  function runBackup() {
    void backupNow();
  }

  function runRestore() {
    Alert.alert(
      'Restore your backup?',
      'This adds anything from your backup that is missing here. Nothing on this phone is deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', style: 'destructive', onPress: () => void restoreNow() },
      ],
    );
  }


  /**
   * Account deletion, as both app stores require it: reachable from inside the
   * app, and a real erasure rather than a flag. The server drops the account,
   * its backup and its uploaded files; this device then wipes its own copy, so
   * "delete" does not leave the library sitting on the phone.
   */
  function confirmDeleteAccount() {
    Alert.alert(
      'Delete your account?',
      'This permanently removes your account, your cloud backup and every file you have uploaded, then erases the items on this phone. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const token = getIdToken();
              if (!token) {
                Alert.alert('Not signed in', 'Sign in first so the account can be removed from the server.');
                return;
              }
              setBusy(true);
              try {
                const outcome = await deleteAccount(token);
                if (outcome !== 'ok') {
                  Alert.alert(
                    'Could not delete the account',
                    'Nothing was removed. Check your connection and try again.',
                  );
                  return;
                }
                await clearAll();
                await clearAllStorage();
                await signOut();
                Alert.alert('Account deleted', 'Your account and data have been removed.');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  /** Local-only erase, for someone who wants the data gone but keeps the account. */
  function confirmEraseDevice() {
    Alert.alert(
      'Erase data on this phone?',
      'Removes every item, photo and document stored on this device. Anything already backed up stays in your backup and can be restored.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await clearAll();
                await clearAllStorage();
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  const stats = useMemo(() => {
    const covered = items.filter((item) => statusOf(item) !== 'expired');
    const value = covered.reduce((total, item) => total + (item.price ?? 0), 0);
    return { tracked: items.length, covered: covered.length, value };
  }, [items]);

  /** Changing a lead time has to rebuild every scheduled reminder. */
  async function onToggle(offset: number) {
    if (busy) return;
    setBusy(true);
    try {
      const next = await toggleOffset(offset);
      await rescheduleAll(next);
    } finally {
      setBusy(false);
    }
  }

  function tap() {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
  }

  return (
    <LargeTitleScreen title="Settings">
      <Section
        header="Account"
        footer={
          signedIn
            ? authProvider !== 'google'
              ? entitlement?.paid
                ? `Subscribed via ${authProvider === 'apple' ? 'Apple' : 'Plenum SSO'} — 500MB Covered Cloud storage enabled.`
                : `Free plan. ${entitlement?.scansRemaining ?? 0} AI scan${(entitlement?.scansRemaining ?? 0) === 1 ? '' : 's'} left, up to ${FREE_ITEM_LIMIT} items.`
              : entitlement?.paid
                ? googleBackupDestination === 'drive'
                  ? 'Subscribed via Google — unlimited Google Drive storage enabled.'
                  : 'Subscribed via Google — 500MB Covered Cloud storage enabled.'
                : `Free plan. ${entitlement?.scansRemaining ?? 0} AI scan${(entitlement?.scansRemaining ?? 0) === 1 ? '' : 's'} left, up to ${FREE_ITEM_LIMIT} items.`
            : 'Sign in to use AI receipt scanning and cloud backups. Your items stay on this device either way.'
        }>
        {signedIn ? (
          <>
            {/*
              Anything but Google gets a plain row: the Drive destination
              toggle below only means something to an account that actually
              has a Google Drive to write to.
            */}
            {authProvider !== 'google' ? (
              <Row
                title={authProvider === 'apple' ? 'Signed in with Apple' : 'Signed in with Plenum'}
                subtitle={entitlement?.paid ? 'Subscribed' : 'Free plan'}
                icon={authProvider === 'apple' ? 'logo-apple' : 'cloud'}
                iconColor={entitlement?.paid ? 'success' : 'accent'}
                chevron={false}
              />
            ) : (
              <>
                <Row
                  title="Signed in with Google"
                  subtitle={entitlement?.paid ? 'Subscribed' : 'Free plan'}
                  icon="person-circle"
                  iconColor={entitlement?.paid ? 'success' : 'accent'}
                  chevron={false}
                />
                {entitlement?.paid ? (
                  <View style={styles.destinationToggleSection}>
                    <ThemedText type="caption" themeColor="textSecondary" style={styles.destinationLabel}>
                      BACKUP DESTINATION
                    </ThemedText>
                    <Segmented
                      options={[
                        { value: 'drive', label: 'Google Drive (Unlimited)' },
                        { value: 'cloud', label: 'Covered Cloud (500MB)' },
                      ]}
                      value={googleBackupDestination}
                      onChange={setGoogleBackupDestination}
                    />
                  </View>
                ) : null}
              </>
            )}
            <Row title="Sign out" destructive centered chevron={false} onPress={() => signOut()} />
          </>
        ) : (
          <>
            <Row
              title={signingIn ? 'Opening Google…' : 'Sign in with Google'}
              icon="logo-google"
              chevron={false}
              onPress={() => signIn()}
              trailing={signingIn ? <ActivityIndicator size="small" /> : undefined}
            />
            {/*
              A Row rather than Apple's own button, to match the Google one
              directly above it. Apple permits a custom control provided it
              keeps their mark and wording, which this does; the welcome sheet
              uses their official button for the primary entry point.
            */}
            {appleAvailable ? (
              <Row
                title={signingIn ? 'Opening Apple…' : 'Sign in with Apple'}
                icon="logo-apple"
                chevron={false}
                onPress={() => signInWithApple()}
                trailing={signingIn ? <ActivityIndicator size="small" /> : undefined}
              />
            ) : null}
            <Row
              title={signingIn ? 'Opening Plenum…' : 'Sign in with Plenum SSO'}
              icon="cloud-outline"
              chevron={false}
              onPress={() => signInWithPlenum()}
              trailing={signingIn ? <ActivityIndicator size="small" /> : undefined}
            />
          </>
        )}
      </Section>

      <Section header="Subscription">
        {premium ? (
          <>
            <Row
              title="Covered Pro Active"
              subtitle="All features and cloud limits unlocked"
              icon="checkmark-circle"
              iconColor="success"
              chevron={false}
            />
            <Row
              title="Customer Center"
              subtitle="Manage plan, change tiers or billing"
              icon="person-circle-outline"
              iconColor="accent"
              onPress={() => void presentCustomerCenter()}
            />
          </>
        ) : (
          <>
            <Row
              title="Upgrade to Covered Pro"
              subtitle="Unlimited scans, items and cloud backup"
              icon="sparkles"
              iconColor="accent"
              onPress={async () => {
                /**
                 * Goes through openPaywall rather than presenting directly.
                 *
                 * Calling presentRevenueCatPaywall here skipped that helper's
                 * "ask first, present second" check, so an offering that fails
                 * to load surfaced RevenueCat's own error alert instead of
                 * dropping to PaywallModal. Its result is also a string, so
                 * the old `if (!purchased)` guard never ran the fallback.
                 */
                const { needsFallback } = await openPaywall();
                if (needsFallback) setShowPaywall(true);
              }}
            />
            <Row
              title="Restore Purchases"
              icon="refresh"
              iconColor="textSecondary"
              onPress={async () => {
                const res = await restorePurchases();
                if (res.success) {
                  Alert.alert('Purchases Restored', 'Your Pro subscription has been restored.');
                } else {
                  Alert.alert('No Active Subscriptions', 'No previous purchases were found for this Apple ID.');
                }
              }}
            />
          </>
        )}
      </Section>

      <Section
          header="Cloud backup"
          footer={
            premium
              ? backupNote ??
                (lastBackupAt
                  ? `Backs up automatically. Last backup ${new Date(lastBackupAt).toLocaleString()}.`
                  : 'Backs up automatically so nothing is lost if you change or lose your phone.')
              : 'Premium keeps your items and receipt photos backed up.'
          }>
          {useCloud && entitlement?.storageUsed !== undefined && entitlement?.storageLimit !== undefined ? (
            <View style={styles.storageUsageSection}>
              <View style={styles.storageUsageTextRow}>
                <ThemedText style={styles.storageUsageLabel}>Cloud Storage</ThemedText>
                <ThemedText style={styles.storageUsageValue}>
                  {formatBytes(entitlement.storageUsed)} / {formatBytes(entitlement.storageLimit)}
                </ThemedText>
              </View>
              <View style={styles.progressBarBackground}>
                <View 
                  style={[
                    styles.progressBarFill, 
                    { 
                      width: `${Math.min(100, (entitlement.storageUsed / entitlement.storageLimit) * 100)}%`,
                      backgroundColor: (entitlement.storageUsed / entitlement.storageLimit) > 0.9 ? theme.danger : theme.accent 
                    }
                  ]} 
                />
              </View>
            </View>
          ) : null}
          <Row
            title="Back up now"
            subtitle={premium ? undefined : 'Premium'}
            icon="cloud-upload"
            iconColor={premium ? 'accent' : 'textTertiary'}
            chevron={false}
            onPress={premium ? runBackup : () => setUpsell('backup')}
            trailing={backupStatus === 'running' ? <ActivityIndicator size="small" /> : undefined}
          />
          <Row
            title="Restore backup"
            subtitle={premium ? undefined : 'Premium'}
            icon="cloud-download"
            iconColor={premium ? 'accent' : 'textTertiary'}
            chevron={false}
            onPress={premium ? runRestore : () => setUpsell('backup')}
            trailing={undefined}
          />
        </Section>

      <Section header="Appearance">
        {APPEARANCES.map((option) => (
          <Row
            key={option.value}
            title={option.label}
            icon={option.icon}
            iconColor={appearance === option.value ? 'accent' : 'textTertiary'}
            chevron={false}
            onPress={() => {
              tap();
              setAppearance(option.value);
            }}
            trailing={
              appearance === option.value ? (
                <Ionicons name="checkmark" size={20} color={theme.accent} />
              ) : undefined
            }
          />
        ))}
      </Section>

      <Section header="Accent colour" footer="Tints buttons, links and the tab bar.">
        <View style={styles.swatchRow}>
          {ACCENT_NAMES.map((name) => {
            const selected = name === accent;
            const colour = scheme === 'dark' ? Accents[name].dark : Accents[name].light;
            return (
              <Pressable
                key={name}
                onPress={() => {
                  tap();
                  setAccent(name);
                }}
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityState={{ selected }}
                style={[styles.swatchRing, { borderColor: selected ? colour : 'transparent' }]}>
                <View style={[styles.swatch, { backgroundColor: colour }]}>
                  {selected ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section
        header="Remind me before cover ends"
        footer="Reminders arrive at 10am on each of the days you pick. Changing these reschedules everything you're tracking.">
        {AVAILABLE_OFFSETS.map((offset) => (
          <Row
            key={offset}
            title={offset === 1 ? '1 day before' : `${offset} days before`}
            icon="notifications"
            iconColor={reminderOffsets.includes(offset) ? 'accent' : 'textTertiary'}
            trailing={
              <Switch
                value={reminderOffsets.includes(offset)}
                onValueChange={() => onToggle(offset)}
                disabled={busy}
                trackColor={{ true: theme.success, false: theme.fill }}
              />
            }
          />
        ))}
      </Section>

      <Section header="Library">
        <Row title="Items tracked" icon="albums" value={String(stats.tracked)} />
        <Row title="Still covered" icon="shield-checkmark" iconColor="success" value={String(stats.covered)} />
        <Row
          title="Value under warranty"
          icon="pricetag"
          iconColor="warning"
          value={stats.value > 0 ? formatPrice(stats.value) : '—'}
        />
      </Section>

      <Section
        header="About"
        footer={
          isAiAvailable()
            ? 'Your items stay on this device. When you scan a receipt, that photo is sent to be read and is not stored.'
            : 'Covered stores everything on this device. Nothing is uploaded.'
        }>
        <Row
          title="Version"
          icon="information-circle"
          iconColor="textSecondary"
          value={Constants.expoConfig?.version ?? '1.0.0'}
          chevron={false}
        />
        <Row title="Made by" icon="cloud" iconColor="accent" value="Plenum" />
      </Section>

      <Section
        header="Your data"
        footer="Deleting your account removes it from our servers along with your backup and uploaded files. This cannot be undone.">
        <Row
          title="Erase data on this phone"
          subtitle="Keeps your account and backup"
          icon="trash-bin"
          iconColor="warning"
          chevron={false}
          onPress={busy ? undefined : confirmEraseDevice}
        />
        <Row
          title="Delete account and all data"
          destructive
          centered
          chevron={false}
          onPress={busy ? undefined : confirmDeleteAccount}
        />
      </Section>

      <UpsellSheet reason={upsell} onClose={() => setUpsell(null)} />
      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />

      <View style={styles.tabInset} />
    </LargeTitleScreen>
  );
}

const styles = StyleSheet.create({
  swatchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: ListMetrics.horizontalInset - 2,
    paddingVertical: Spacing.two + 4,
  },
  swatchRing: {
    padding: 2,
    borderWidth: 2,
    borderRadius: Radius.pill,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInset: { height: Spacing.six + Spacing.four },
  destinationToggleSection: {
    paddingHorizontal: ListMetrics.horizontalInset,
    paddingBottom: Spacing.three,
    paddingTop: Spacing.one,
  },
  destinationLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: Spacing.two,
    textTransform: 'uppercase',
  },
  storageUsageSection: {
    paddingHorizontal: ListMetrics.horizontalInset,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  storageUsageTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  storageUsageLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  storageUsageValue: {
    fontSize: 13,
    color: '#666',
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#EAEAEA',
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
});

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
