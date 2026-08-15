import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UpsellSheet, type UpsellReason } from '@/components/upsell-sheet';
import { InputRow } from '@/components/ui/input-row';
import { LargeTitleScreen } from '@/components/ui/large-title-screen';
import { Row, Section } from '@/components/ui/list';
import { ACCENT_NAMES, Accents, ListMetrics, Radius, Spacing, type Appearance } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { isAiAvailable } from '@/lib/ai-receipt';
import { formatPrice, statusOf } from '@/lib/warranty';
import { useAuth } from '@/store/auth';
import { useItems } from '@/store/items';
import { useBackup } from '@/store/backup';
import { redeemCode } from '@/lib/api';
import { Segmented } from '@/components/ui/segmented';
import { AVAILABLE_OFFSETS, useSettings } from '@/store/settings';
import { FREE_ITEM_LIMIT } from '@/lib/limits';

const APPEARANCES: { value: Appearance; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'system', label: 'Match device', icon: 'contrast' },
  { value: 'light', label: 'Light', icon: 'sunny' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { items, rescheduleAll } = useItems();
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
  const { signedIn, entitlement, signingIn, signIn, signInWithPlenum, signInWithCode, signOut, getIdToken, refresh, authProvider } =
    useAuth();
  const [busy, setBusy] = useState(false);
  const useCloud = authProvider === 'plenum' || (authProvider === 'google' && googleBackupDestination === 'cloud');


  // Tapping the version row a few times reveals the code field.
  const [upsell, setUpsell] = useState<UpsellReason>(null);
  const [versionTaps, setVersionTaps] = useState(0);
  const [codeDraft, setCodeDraft] = useState('');
  const [accessDraft, setAccessDraft] = useState('');
  const [showAccess, setShowAccess] = useState(false);

  async function submitAccessCode() {
    const code = accessDraft.trim();
    if (!code) return;
    const ok = await signInWithCode(code);
    if (ok) {
      setAccessDraft('');
      setShowAccess(false);
      tap();
    } else {
      Alert.alert('That code did not work', 'Check it and try again.');
    }
  }

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

  async function submitCode() {
    const token = getIdToken();
    const code = codeDraft.trim();
    if (!token || !code) return;
    const outcome = await redeemCode(token, code);
    if (outcome === 'ok') {
      await refresh();
      setCodeDraft('');
      setVersionTaps(0);
      Alert.alert('Premium unlocked', 'Cloud backup and unlimited scans are now enabled.');
    } else if (outcome === 'invalid') {
      Alert.alert('That code did not work', 'Check it and try again.');
    } else {
      Alert.alert('Could not reach the server', 'Try again in a moment.');
    }
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
            ? authProvider === 'plenum'
              ? entitlement?.paid
                ? 'Subscribed via Plenum SSO — 500MB Covered Cloud storage enabled.'
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
            {authProvider === 'plenum' ? (
              <Row
                title="Signed in with Plenum"
                subtitle={entitlement?.paid ? 'Subscribed' : 'Free plan'}
                icon="cloud"
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
            <Row
              title={signingIn ? 'Opening Plenum…' : 'Sign in with Plenum SSO'}
              icon="cloud-outline"
              chevron={false}
              onPress={() => signInWithPlenum()}
              trailing={signingIn ? <ActivityIndicator size="small" /> : undefined}
            />
            <Row
              title="Use an access code"
              subtitle="For devices where Google Sign-In isn't available"
              icon="key"
              iconColor="textSecondary"
              chevron={false}
              onPress={() => setShowAccess((open) => !open)}
            />
            {showAccess ? (
              <InputRow
                label="Code"
                value={accessDraft}
                onChangeText={setAccessDraft}
                placeholder="Enter access code"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={submitAccessCode}
              />
            ) : null}
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
          onPress={() => setVersionTaps((count) => count + 1)}
        />
        {versionTaps >= 7 && !premium ? (
          <InputRow
            label="Code"
            value={codeDraft}
            onChangeText={setCodeDraft}
            placeholder="Enter code"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submitCode}
          />
        ) : null}
        <Row title="Made by" icon="cloud" iconColor="accent" value="Plenum" />
      </Section>

      <UpsellSheet reason={upsell} onClose={() => setUpsell(null)} />

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
