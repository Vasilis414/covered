/**
 * Verifies Sign in with Apple identity tokens.
 *
 * Same shape as google-auth: the app authenticates with Apple and sends the
 * resulting identity token, and this checks the signature against Apple's
 * published keys and the standard claims. Kept in its own module rather than
 * generalised with Google's, because the two differ in ways that matter — Apple
 * signs some keys with ES256, and its audience is the bundle id rather than an
 * OAuth client id.
 */

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

export type AppleIdentity = {
  sub: string;
  email?: string;
  /**
   * True when Apple issued a relay address rather than the real one.
   *
   * Worth carrying because a @privaterelay.appleid.com address cannot be used
   * to match this person against an account they created with Google — so it
   * must never be treated as evidence that two accounts are the same person.
   */
  isPrivateRelay: boolean;
};

type Jwk = {
  kid: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
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
 * Apple rotates its keys, so they cannot be baked in. Cached by Cloudflare
 * rather than in a module variable, which would be per-isolate mutable state.
 */
async function fetchKey(kid: string, alg: string): Promise<CryptoKey | null> {
  const response = await fetch(APPLE_JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!response.ok) return null;

  const { keys } = (await response.json()) as { keys: Jwk[] };
  const jwk = keys.find((candidate) => candidate.kid === kid);
  if (!jwk) return null;

  if (alg === 'RS256' && jwk.n && jwk.e) {
    return crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  }

  if (alg === 'ES256' && jwk.x && jwk.y) {
    return crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv ?? 'P-256', x: jwk.x, y: jwk.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  }

  return null;
}

/**
 * Returns the caller's Apple identity, or null if the token is missing,
 * malformed, expired, signed by the wrong key, or issued for a different app.
 */
export async function verifyAppleIdentityToken(
  token: string,
  allowedAudiences: string[],
): Promise<AppleIdentity | null> {
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

  const alg = typeof header.alg === 'string' ? header.alg : '';
  if ((alg !== 'RS256' && alg !== 'ES256') || typeof header.kid !== 'string') return null;

  const key = await fetchKey(header.kid, alg);
  if (!key) return null;

  const verified = await crypto.subtle.verify(
    alg === 'ES256'
      ? { name: 'ECDSA', hash: 'SHA-256' }
      : { name: 'RSASSA-PKCS1-v1_5' },
    key,
    base64UrlToBytes(signatureSegment),
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
  );
  if (!verified) return null;

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  const sub = typeof payload.sub === 'string' ? payload.sub : '';

  /**
   * Apple sends `aud` as a string for a single audience.
   *
   * Checked for the same reason Google's is: without it, an identity token
   * minted for any other app signed by Apple would be accepted here.
   */
  const aud = typeof payload.aud === 'string' ? payload.aud : '';

  if (exp <= now) return null;
  if (iss !== APPLE_ISSUER) return null;
  if (allowedAudiences.length === 0 || !allowedAudiences.includes(aud)) return null;
  if (!sub) return null;

  const email = typeof payload.email === 'string' ? payload.email : undefined;

  return {
    sub,
    email,
    /**
     * Apple marks this claim itself; the address suffix is a fallback for
     * tokens that omit it.
     */
    isPrivateRelay:
      payload.is_private_email === true ||
      payload.is_private_email === 'true' ||
      (email?.endsWith('@privaterelay.appleid.com') ?? false),
  };
}
