/**
 * Verifies Google ID tokens without an auth vendor.
 *
 * The app signs in with Google and sends the resulting ID token; this checks
 * the signature against Google's published keys and the standard claims. That
 * is the whole of "accounts" when Google is the only sign-in method — no
 * passwords, no reset flows, no session store.
 */

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export type GoogleIdentity = {
  sub: string;
  email?: string;
  name?: string;
};

type Jwk = {
  kid: string;
  n: string;
  e: string;
  alg?: string;
  kty: string;
};

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

/**
 * Google's keys rotate, so they can't be baked in. Cloudflare's cache holds the
 * response rather than a module-level variable, which would be per-isolate
 * mutable state.
 */
async function fetchKey(kid: string): Promise<CryptoKey | null> {
  const response = await fetch(GOOGLE_JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!response.ok) return null;

  const { keys } = (await response.json()) as { keys: Jwk[] };
  const jwk = keys.find((candidate) => candidate.kid === kid);
  if (!jwk) return null;

  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

/**
 * Returns the caller's identity, or null if the token is missing, malformed,
 * expired, signed by the wrong key, or issued for a different app.
 */
export async function verifyGoogleIdToken(
  token: string,
  allowedAudiences: string[],
): Promise<GoogleIdentity | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerSegment, payloadSegment, signatureSegment] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(headerSegment);
    payload = decodeJson(payloadSegment);
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  const key = await fetchKey(header.kid);
  if (!key) return null;

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(signatureSegment),
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
  );
  if (!verified) return null;

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  const aud = typeof payload.aud === 'string' ? payload.aud : '';
  const sub = typeof payload.sub === 'string' ? payload.sub : '';

  if (exp <= now) return null;
  if (!GOOGLE_ISSUERS.includes(iss)) return null;
  // Without this check any Google token from any app would be accepted.
  if (allowedAudiences.length === 0 || !allowedAudiences.includes(aud)) return null;
  if (!sub) return null;

  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
  };
}
