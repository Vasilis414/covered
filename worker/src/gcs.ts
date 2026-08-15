/**
 * Google Cloud Storage helpers for Cloudflare Workers.
 *
 * Uses Web Crypto to sign a JWT with the service-account's RSA private key,
 * then exchanges it for an OAuth2 access token. All GCS operations go through
 * the JSON API so there is no dependency on gRPC or Node-only libraries.
 */

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GCS_BASE = 'https://storage.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

/** Parsed service-account JSON key file. */
interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id: string;
}

/** In-memory token cache so we don't re-sign on every request. */
let cachedToken: { token: string; expiresAt: number } | null = null;

// ─── JWT + OAuth ────────────────────────────────────────────────────────────

function base64url(input: Uint8Array): string {
  const raw = [...input].map((b) => String.fromCharCode(b)).join('');
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlString(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Import a PEM RSA private key into a CryptoKey usable for RS256 signing.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binaryString = atob(stripped);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * Create and sign a Google OAuth2 JWT assertion using RS256.
 */
async function createSignedJwt(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlString(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const payload = base64urlString(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

/**
 * Returns a short-lived OAuth2 access token for GCS.
 * Caches the token in memory for the worker's lifetime (up to 1 hour).
 */
export async function getGcsAccessToken(serviceAccountKeyJson: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const sa: ServiceAccountKey = JSON.parse(serviceAccountKeyJson);
  const jwt = await createSignedJwt(sa);

  const response = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GCS token exchange failed (${response.status}): ${text}`);
  }

  const result = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: result.access_token,
    // Refresh 5 minutes early to avoid edge-case expiry mid-request.
    expiresAt: Date.now() + (result.expires_in - 300) * 1000,
  };
  return cachedToken.token;
}

// ─── GCS Object Operations ──────────────────────────────────────────────────

/**
 * Upload a binary object to GCS.
 * Uses the simple upload endpoint (media upload).
 */
export async function uploadToGcs(
  bucket: string,
  objectName: string,
  data: Uint8Array,
  mimeType: string,
  accessToken: string,
): Promise<void> {
  const url = `${GCS_BASE}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'Content-Length': String(data.byteLength),
    },
    body: data,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GCS upload failed (${response.status}): ${text}`);
  }
}

/**
 * Download an object from GCS. Returns the raw bytes and content-type.
 */
export async function downloadFromGcs(
  bucket: string,
  objectName: string,
  accessToken: string,
): Promise<{ data: ArrayBuffer; contentType: string }> {
  const url = `${GCS_BASE}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`GCS download failed (${response.status})`);
  }

  return {
    data: await response.arrayBuffer(),
    contentType: response.headers.get('Content-Type') || 'application/octet-stream',
  };
}

/**
 * Delete an object from GCS.
 */
export async function deleteFromGcs(
  bucket: string,
  objectName: string,
  accessToken: string,
): Promise<void> {
  const url = `${GCS_BASE}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 404 is fine — the object was already gone.
  if (!response.ok && response.status !== 404) {
    throw new Error(`GCS delete failed (${response.status})`);
  }
}
