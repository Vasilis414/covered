import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Alert, AppState, Platform } from 'react-native';

import { fetchEntitlement, type Entitlement } from '@/lib/api';
import { DRIVE_SCOPE } from '@/lib/drive-backup';

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'covered.google.idtoken';

/**
 * The last entitlement the server told us about.
 *
 * Kept so a paid account still looks paid with no signal. Deliberately in
 * AsyncStorage rather than the Keychain: it is a cache, not a credential, and
 * unlike the Keychain it is wiped when the app is deleted.
 */
const ENTITLEMENT_KEY = 'covered.entitlement.v1';

/** Google ID tokens last an hour; a session must outlive that on its own. */
async function readCachedEntitlement(): Promise<Entitlement | null> {
  try {
    const raw = await AsyncStorage.getItem(ENTITLEMENT_KEY);
    return raw ? (JSON.parse(raw) as Entitlement) : null;
  } catch {
    return null;
  }
}

async function cacheEntitlement(value: Entitlement | null): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(value));
    else await AsyncStorage.removeItem(ENTITLEMENT_KEY);
  } catch {
    // A cache that fails to write is not worth failing a sign-in over.
  }
}

/**
 * Public OAuth client IDs. These ship in the app by design — only the client
 * *secret* must never leave the server, and we don't use one.
 *
 * The ID token Google returns is issued for the WEB client, which is why the
 * Worker accepts that audience as well as the platform ones.
 */
const WEB_CLIENT_ID = '1001340597486-ncplfopef1vgrbhjiqvljo8u3ug60ooq.apps.googleusercontent.com';
const IOS_CLIENT_ID = '1001340597486-tp514u7qv82a06472643b1il7b8j6biv.apps.googleusercontent.com';

type GoogleSigninModule = {
  GoogleSignin: {
    configure: (options: Record<string, unknown>) => void;
    hasPlayServices: (options?: Record<string, unknown>) => Promise<boolean>;
    signIn: () => Promise<{ data?: { idToken?: string | null } | null; type?: string }>;
    /** Re-issues an ID token from the stored credential, with no UI. */
    signInSilently: () => Promise<{ data?: { idToken?: string | null } | null; type?: string }>;
    signOut: () => Promise<void>;
    getTokens: () => Promise<{ accessToken?: string | null }>;
  };
};

/** Expo Go can't contain custom native modules, whatever the app requires. */
const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';

/**
 * Native sign-in is a native module, so it exists in a real build and not in
 * Expo Go. Without it the app still runs; only the account features go quiet.
 *
 * The Expo Go check comes first and is not optional. Requiring the package
 * there throws from TurboModuleRegistry.getEnforcing during module init, and
 * that throw escapes a try/catch around the require — it surfaces as an
 * uncaught error and red-screens the app.
 *
 * The browser-based flow this replaces cannot work at all on Android — Google
 * rejects it with "Custom URI scheme is not enabled for your Android client".
 */
function loadGoogle(): GoogleSigninModule['GoogleSignin'] | null {
  if (IS_EXPO_GO) return null;
  try {
    const module = require('@react-native-google-signin/google-signin') as GoogleSigninModule;
    return module?.GoogleSignin ?? null;
  } catch {
    return null;
  }
}

type AuthContextValue = {
  ready: boolean;
  signedIn: boolean;
  authProvider: 'google' | 'plenum' | null;
  entitlement: Entitlement | null;
  signingIn: boolean;
  /** False in Expo Go, where the native module is absent. */
  available: boolean;
  signIn: () => Promise<void>;
  signInWithPlenum: () => Promise<void>;
  /** Fallback login for platforms without Google Sign-In, e.g. Expo Go. */
  signInWithCode: (code: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  getIdToken: () => string | undefined;
  /** OAuth access token for Drive. Null when signed out or the grant failed. */
  getAccessToken: () => Promise<string | null>;
  setEntitlement: (entitlement: Entitlement) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [ready, setReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  /**
   * Memoised because half the callbacks below close over it. require() does
   * hand back the same module object every time, but an effect that re-runs on
   * every render if that ever stops being true is not worth the gamble.
   */
  const google = useMemo(() => loadGoogle(), []);
  const available = google !== null;

  useEffect(() => {
    if (!google) return;
    google.configure({
      webClientId: WEB_CLIENT_ID,
      iosClientId: IOS_CLIENT_ID,
      offlineAccess: false,
      // Backups go to the user's own Drive, in this app's hidden folder.
      scopes: [DRIVE_SCOPE],
    });
  }, [google]);

  const applyToken = useCallback(async (token: string | null) => {
    setIdToken(token);
    if (!token) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await cacheEntitlement(null);
      setEntitlement(null);
      return;
    }
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    const result = await fetchEntitlement(token);
    if (result.ok) {
      setEntitlement(result.entitlement);
      await cacheEntitlement(result.entitlement);
    }
  }, []);

  /** Ends the local session without pretending Google's is ours to end. */
  const clearSession = useCallback(async () => {
    setIdToken(null);
    setEntitlement(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await cacheEntitlement(null);
  }, []);

  /**
   * Trades the stored Google credential for a fresh ID token without any UI.
   * This is what makes a session outlive the token's one-hour life.
   */
  const renewToken = useCallback(async (): Promise<string | null> => {
    if (!google) return null;
    try {
      const result = await google.signInSilently();
      return result?.data?.idToken ?? null;
    } catch {
      return null;
    }
  }, [google]);

  /**
   * Confirms the stored session is still good, renewing it if the hour is up.
   *
   * The three outcomes are kept apart on purpose. Only the server explicitly
   * rejecting a token — after a silent renewal has also failed — is grounds for
   * signing someone out; being unable to reach the server is not.
   */
  const verifySession = useCallback(
    async (token: string, stillMounted: () => boolean) => {
      const result = await fetchEntitlement(token);
      if (!stillMounted()) return;

      if (result.ok) {
        setEntitlement(result.entitlement);
        await cacheEntitlement(result.entitlement);
        return;
      }
      // Offline. Keep the session and the cached plan; try again next time.
      if (result.reason === 'network') return;

      // Plenum SSO tokens cannot be silently renewed via Google.
      // Keep the local session alive and let subsequent API calls prompt re-login on 401.
      if (token.startsWith('plenum:')) {
        return;
      }

      const fresh = await renewToken();
      if (!stillMounted()) return;
      if (!fresh) {
        await clearSession();
        return;
      }

      await SecureStore.setItemAsync(TOKEN_KEY, fresh);
      setIdToken(fresh);
      const retry = await fetchEntitlement(fresh);
      if (!stillMounted()) return;
      if (retry.ok) {
        setEntitlement(retry.entitlement);
        await cacheEntitlement(retry.entitlement);
      } else if (retry.reason === 'auth') {
        await clearSession();
      }
    },
    [renewToken, clearSession],
  );

  /**
   * Restore the previous session, then check it.
   *
   * The stored session is trusted first and verified second. Waiting for the
   * network before deciding whether someone is signed in means every launch
   * starts as a signed-out app, which flashes the wrong UI and, when there was
   * no signal, used to end with the credential deleted.
   */
  useEffect(() => {
    let active = true;
    const stillMounted = () => active;

    (async () => {
      const stored = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
      if (!active) return;

      if (!stored) {
        setReady(true);
        return;
      }

      const cached = await readCachedEntitlement();
      if (!active) return;
      setIdToken(stored);
      if (cached) setEntitlement(cached);
      setReady(true);

      await verifySession(stored, stillMounted);
    })().catch(() => active && setReady(true));

    return () => {
      active = false;
    };
  }, [verifySession]);

  /**
   * Coming back to the app is exactly when an hour has quietly passed, so the
   * session is re-checked on foreground rather than only at launch.
   */
  useEffect(() => {
    if (!idToken) return;
    let active = true;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void verifySession(idToken, () => active);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [idToken, verifySession]);

  const authProvider = useMemo<'google' | 'plenum' | null>(() => {
    if (!idToken) return null;
    if (idToken.startsWith('plenum:')) return 'plenum';
    return 'google';
  }, [idToken]);

  const signIn = useCallback(async () => {
    if (!google) {
      Alert.alert(
        'Not available here',
        'Signing in needs the installed app — Expo Go cannot include Google Sign-In.',
      );
      return;
    }

    setSigningIn(true);
    try {
      if (Platform.OS === 'android') {
        await google.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }
      const result = await google.signIn();
      const token = result?.data?.idToken;
      if (token) {
        await applyToken(token);
      }
    } catch (error) {
      const message = String(error);
      // Cancelling is not a failure worth interrupting anyone over.
      if (!/cancel/i.test(message)) {
        Alert.alert('Could not sign in', message);
      }
    } finally {
      setSigningIn(false);
    }
  }, [google, applyToken]);

  const signInWithPlenum = useCallback(async () => {
    setSigningIn(true);
    try {
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'covered' });
      const state = Math.random().toString(36).substring(7);
      const host = 'https://plenum.gr';
      const client_id = 'covered-app';
      const authUrl = `${host}/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      
      if (result.type === 'success' && result.url) {
        const getQueryParam = (url: string, param: string) => {
          const regex = new RegExp('[?&]' + param + '=([^&#]*)');
          const match = regex.exec(url);
          return match === null ? null : decodeURIComponent(match[1].replace(/\+/g, ' '));
        };

        const code = getQueryParam(result.url, 'code');
        const returnedState = getQueryParam(result.url, 'state');

        if (!code) {
          Alert.alert('Authentication Failed', 'No authorization code returned.');
          return;
        }
        if (returnedState !== state) {
          Alert.alert('Authentication Failed', 'CSRF verification failed (state mismatch).');
          return;
        }

        const tokenResponse = await fetch(`${host}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id,
          }),
        });

        if (!tokenResponse.ok) {
          const errText = await tokenResponse.text();
          throw new Error(`Token exchange failed: ${errText}`);
        }

        const tokens = (await tokenResponse.json()) as { access_token: string };
        const plenumToken = `plenum:${tokens.access_token}`;

        await applyToken(plenumToken);
      }
    } catch (error) {
      Alert.alert('Authentication Error', String(error));
    } finally {
      setSigningIn(false);
    }
  }, [applyToken]);

  /**
   * Signs in with an access code instead of Google.
   *
   * Expo Go cannot contain custom native modules, so a real Google ID token is
   * unobtainable there. The code is verified by the server — it is not a local
   * bypass, and it resolves to a single fixed account.
   */
  const signInWithCode = useCallback(
    async (code: string) => {
      const token = `devtoken:${code.trim()}`;
      const result = await fetchEntitlement(token);
      if (!result.ok) return false;
      setIdToken(token);
      setEntitlement(result.entitlement);
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await cacheEntitlement(result.entitlement);
      return true;
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await google?.signOut();
    } catch {
      // Clearing our own token matters more than Google's session.
    }
    await applyToken(null);
  }, [google, applyToken]);

  const refresh = useCallback(async () => {
    if (!idToken) return;
    const result = await fetchEntitlement(idToken);
    if (result.ok) {
      setEntitlement(result.entitlement);
      await cacheEntitlement(result.entitlement);
    }
  }, [idToken]);

  const getIdToken = useCallback(() => idToken ?? undefined, [idToken]);

  // Access tokens are short-lived; the native SDK refreshes them, so always ask
  // rather than caching one.
  /**
   * The Google OAuth access token, used for Drive.
   *
   * getTokens() throws when the native SDK has no current user, which is the
   * state after a reinstall: our own ID token survives in the Keychain, so the
   * app looks signed in, while Google's SDK session is empty. Returning null
   * there meant Drive backup quietly never ran and every photo stayed local.
   * A silent sign-in restores the SDK's session without any UI.
   */
  const getAccessToken = useCallback(async () => {
    if (!google) return null;

    try {
      const tokens = await google.getTokens();
      if (tokens?.accessToken) return tokens.accessToken;
    } catch {
      // Fall through and try to restore the session.
    }

    try {
      await google.signInSilently();
      const tokens = await google.getTokens();
      return tokens?.accessToken ?? null;
    } catch {
      return null;
    }
  }, [google]);

  const value = useMemo(
    () => ({
      ready,
      signedIn: Boolean(idToken),
      authProvider,
      entitlement,
      signingIn,
      available,
      signIn,
      signInWithPlenum,
      signInWithCode,
      signOut,
      refresh,
      getIdToken,
      getAccessToken,
      setEntitlement,
    }),
    [ready, idToken, authProvider, entitlement, signingIn, available, signIn, signInWithPlenum, signInWithCode, signOut, refresh, getIdToken, getAccessToken],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
