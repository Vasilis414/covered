import * as SecureStore from 'expo-secure-store';

/**
 * Where the Gemini key lives.
 *
 * Deliberately NOT in the JS bundle. Anything baked in at build time — an
 * EXPO_PUBLIC_ env var, a constant — ships inside the APK and can be read by
 * anyone who unzips it, or served to anyone who can reach a dev server. Instead
 * the key is pasted into Settings on each device and kept in the platform
 * keychain, so the app can be hosted and shared without leaking anything.
 *
 * A build-time env var is still honoured as a fallback for local development.
 */

const STORE_KEY = 'covered.gemini.key';
const ENV_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

/** Cached so the scan path can stay synchronous. Hydrated once at startup. */
let cachedKey: string | null = null;
let hydrated = false;

export async function hydrateAiKey(): Promise<void> {
  if (hydrated) return;
  try {
    cachedKey = await SecureStore.getItemAsync(STORE_KEY);
  } catch {
    cachedKey = null;
  } finally {
    hydrated = true;
  }
}

export async function setAiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed) {
    await SecureStore.setItemAsync(STORE_KEY, trimmed);
    cachedKey = trimmed;
  } else {
    await SecureStore.deleteItemAsync(STORE_KEY);
    cachedKey = null;
  }
  hydrated = true;
}

export async function clearAiKey(): Promise<void> {
  await setAiKey('');
}

export function getAiKey(): string | undefined {
  return cachedKey ?? ENV_KEY ?? undefined;
}

export function hasAiKey(): boolean {
  return Boolean(getAiKey());
}
