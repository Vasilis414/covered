import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clearAiKey, hasAiKey, hydrateAiKey, setAiKey } from '@/lib/ai-config';
import type { AccentName, Appearance } from '@/constants/theme';

const KEY = 'covered.settings.v1';

/** Lead times, in days before expiry, that a reminder can be scheduled for. */
export const AVAILABLE_OFFSETS = [90, 30, 7, 1] as const;

export const DEFAULT_OFFSETS: number[] = [30, 7, 1];

type Settings = {
  reminderOffsets: number[];
  appearance: Appearance;
  accent: AccentName;
};

const DEFAULTS: Settings = {
  reminderOffsets: DEFAULT_OFFSETS,
  appearance: 'system',
  accent: 'blue',
};

type SettingsContextValue = Settings & {
  ready: boolean;
  toggleOffset: (offset: number) => Promise<number[]>;
  setAppearance: (appearance: Appearance) => void;
  setAccent: (accent: AccentName) => void;
  /** Whether a Gemini key is stored on this device. The key itself never leaves the keychain. */
  aiKeySet: boolean;
  saveAiKey: (key: string) => Promise<void>;
  forgetAiKey: () => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [aiKeySet, setAiKeySet] = useState(false);

  useEffect(() => {
    // The key lives in the keychain, not in this JSON blob.
    hydrateAiKey().then(() => setAiKeySet(hasAiKey()));
  }, []);

  const saveAiKey = useCallback(async (key: string) => {
    await setAiKey(key);
    setAiKeySet(hasAiKey());
  }, []);

  const forgetAiKey = useCallback(async () => {
    await clearAiKey();
    setAiKeySet(false);
  }, []);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!active || !raw) return;
        const parsed = JSON.parse(raw);
        // Merge rather than replace, so settings added in later versions keep
        // their defaults instead of coming back undefined.
        setSettings({ ...DEFAULTS, ...parsed });
      })
      .catch(() => {})
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((next: Settings) => {
    setSettings(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
    return next;
  }, []);

  /** Returns the new set so callers can reschedule against it immediately. */
  const toggleOffset = useCallback(
    async (offset: number) => {
      const reminderOffsets = settings.reminderOffsets.includes(offset)
        ? settings.reminderOffsets.filter((value) => value !== offset)
        : [...settings.reminderOffsets, offset].sort((a, b) => b - a);

      persist({ ...settings, reminderOffsets });
      return reminderOffsets;
    },
    [persist, settings],
  );

  const setAppearance = useCallback(
    (appearance: Appearance) => {
      persist({ ...settings, appearance });
    },
    [persist, settings],
  );

  const setAccent = useCallback(
    (accent: AccentName) => {
      persist({ ...settings, accent });
    },
    [persist, settings],
  );

  const value = useMemo(
    () => ({
      ...settings,
      ready,
      toggleOffset,
      setAppearance,
      setAccent,
      aiKeySet,
      saveAiKey,
      forgetAiKey,
    }),
    [settings, ready, toggleOffset, setAppearance, setAccent, aiKeySet, saveAiKey, forgetAiKey],
  );

  return <SettingsContext value={value}>{children}</SettingsContext>;
}

export function useSettings(): SettingsContextValue {
  const context = use(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside <SettingsProvider>');
  return context;
}
