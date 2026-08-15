import { verifyGoogleIdToken, type GoogleIdentity } from './google-auth';

/**
 * Covered's scan proxy.
 *
 * Exists so the Gemini key never ships in the app. The phone sends a receipt
 * photo with its Google ID token; this verifies who they are, checks whether
 * they're allowed another scan, calls Gemini, and records the usage.
 *
 * Routes:
 *   GET  /me    — account, plan and remaining scans
 *   POST /scan  — { image, mimeType } -> extracted receipt JSON
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1/interactions';

/** Photos are a few hundred KB; multi-page PDF receipts need more headroom. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** Gemini reads PDFs directly, so they take the same path as an image. */
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

const PROMPT = `You are reading a purchase receipt for a warranty-tracking app.

The file may be a photo of a receipt or a PDF receipt or invoice.\n\nExtract every physical product or service that was actually purchased. Ignore
subtotals, taxes, discounts, payment lines, card numbers and loyalty messages.

For each product:
- description: the full product name, joining lines that wrap. Do not include
  the quantity prefix or the price.
- price: the price for that line, as a number, no currency symbol.
- brand: the manufacturer if you can tell. Omit if unsure.
- category: exactly one of Electronics, Appliance, Furniture, Vehicle, Tools, Other.
- warrantyMonths: how long this product is typically covered, in months. If the
  receipt states a warranty, use that. Extended-cover plans such as AppleCare+
  are 24. Otherwise use a sensible default for the product type.

Also extract the shop name, the purchase date as YYYY-MM-DD, and the grand total.
If a value is not present, omit the field rather than guessing.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    retailer: { type: 'string' },
    purchaseDate: { type: 'string' },
    total: { type: 'number' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          price: { type: 'number' },
          brand: { type: 'string' },
          category: {
            type: 'string',
            enum: ['Electronics', 'Appliance', 'Furniture', 'Vehicle', 'Tools', 'Other'],
          },
          warrantyMonths: { type: 'integer' },
        },
        required: ['description', 'price'],
      },
    },
  },
} as const;

type Account = {
  userId: string;
  plan: string;
  expiresAt: string | null;
  /** Scans attempted — the abuse ceiling. */
  scansUsed: number;
  /** Scans the user accepted as good — the real free allowance. */
  scansCharged: number;
};

/**
 * A free scan is only spent when the result was good enough to save unedited,
 * so a poor scan doesn't burn someone's one try. Attempts still need a ceiling
 * or editing a single character would buy unlimited scanning.
 */
const MAX_FREE_ATTEMPTS = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isPaid(account: Account): boolean {
  if (account.userId.startsWith('plenum:')) return true;
  if (account.plan === 'free') return false;
  if (!account.expiresAt) return true;
  return new Date(account.expiresAt).getTime() > Date.now();
}

/** Finds or creates the account rows for a verified Google identity. */
async function loadAccount(env: Env, identity: GoogleIdentity): Promise<Account> {
  const existing = await env.DB.prepare(
    `SELECT u.id AS userId, COALESCE(e.plan,'free') AS plan, e.expires_at AS expiresAt,
            COALESCE(us.ai_scans_used,0) AS scansUsed,
            COALESCE(us.ai_scans_charged,0) AS scansCharged
       FROM users u
       LEFT JOIN entitlements e ON e.user_id = u.id
       LEFT JOIN usage us ON us.user_id = u.id
      WHERE u.google_sub = ?`,
  )
    .bind(identity.sub)
    .first<Account>();

  if (existing) {
    await env.DB.prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`)
      .bind(existing.userId)
      .run();
    return existing;
  }

  const userId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, last_seen_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).bind(userId, identity.sub, identity.email ?? null, identity.name ?? null),
    env.DB.prepare(`INSERT INTO entitlements (user_id, plan) VALUES (?, 'free')`).bind(userId),
    env.DB.prepare(`INSERT INTO usage (user_id, ai_scans_used) VALUES (?, 0)`).bind(userId),
  ]);

  return { userId, plan: 'free', expiresAt: null, scansUsed: 0, scansCharged: 0 };
}

/** Prefix marking an access-code login rather than a Google ID token. */
const DEV_PREFIX = 'devtoken:';

function timingSafeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right);
}

async function authenticate(request: Request, env: Env): Promise<GoogleIdentity | null> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  if (token.startsWith('plenum:')) {
    const plenumToken = token.slice('plenum:'.length);
    try {
      const response = await fetch('https://plenum-cloud.fly.dev/oauth/userinfo', {
        headers: { Authorization: `Bearer ${plenumToken}` }
      });
      if (!response.ok) return null;
      const profile = await response.json() as { sub: string; email?: string; name?: string };
      if (!profile || !profile.sub) return null;
      return { sub: 'plenum:' + profile.sub, email: profile.email, name: profile.name };
    } catch {
      return null;
    }
  }

  /**
   * Access-code login, for platforms where Google Sign-In can't run — Expo Go
   * cannot contain custom native modules, so there is no way to obtain a real
   * ID token there. The code is a server secret, never shipped in the app, and
   * resolves to one fixed account rather than opening the endpoint up.
   */
  if (token.startsWith(DEV_PREFIX)) {
    const supplied = token.slice(DEV_PREFIX.length);
    const expected = env.DEV_ACCESS_TOKEN ?? '';
    if (!expected || !timingSafeEquals(supplied, expected)) return null;
    return { sub: 'access-code-user', email: 'access-code@covered.app', name: 'Access code' };
  }

  const audiences = (env.GOOGLE_CLIENT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return verifyGoogleIdToken(token, audiences);
}

async function handleScan(request: Request, env: Env, account: Account): Promise<Response> {
  const freeLimit = Number(env.FREE_SCAN_LIMIT ?? '1');

  if (!isPaid(account)) {
    if (account.scansCharged >= freeLimit) {
      return json({ error: 'scan_limit_reached', freeLimit }, 402);
    }
    if (account.scansUsed >= MAX_FREE_ATTEMPTS) {
      return json({ error: 'attempt_limit_reached', maxAttempts: MAX_FREE_ATTEMPTS }, 402);
    }
  }

  let body: { image?: unknown; mimeType?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const image = typeof body.image === 'string' ? body.image : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg';

  if (!image) return json({ error: 'missing_image' }, 400);
  if (!ALLOWED_MIME.has(mimeType)) return json({ error: 'unsupported_type' }, 415);
  // Base64 inflates by ~4/3; compare against the decoded size.
  if ((image.length * 3) / 4 > MAX_UPLOAD_BYTES) return json({ error: 'image_too_large' }, 413);

  const upstream = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      model: env.GEMINI_MODEL,
      // Stateless: receipts are not retained by the model provider.
      store: false,
      input: [
        {
          type: 'user_input',
          content: [
            { type: 'image', mime_type: mimeType, data: image },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
      response_format: [{ type: 'text', mime_type: 'application/json', schema: RESPONSE_SCHEMA }],
    }),
  });

  if (!upstream.ok) {
    console.log(JSON.stringify({ event: 'gemini_error', status: upstream.status }));
    return json({ error: 'upstream_failed' }, 502);
  }

  const payload = (await upstream.json()) as {
    steps?: { type?: string; content?: { text?: string }[] }[];
  };

  const text = (payload.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .map((part) => part.text)
    .filter(Boolean)
    .join('');

  if (!text) return json({ error: 'empty_response' }, 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: 'unparseable_response' }, 502);
  }

  // Count the attempt now; whether it *costs* them a free scan is decided
  // later, when they either save the result as-is or correct it.
  await env.DB.prepare(
    `UPDATE usage SET ai_scans_used = ai_scans_used + 1, last_scan_at = datetime('now')
      WHERE user_id = ?`,
  )
    .bind(account.userId)
    .run();

  return json(parsed);
}


/** A whole library is a few KB of JSON; anything this large is not one. */
const MAX_BACKUP_BYTES = 2 * 1024 * 1024;

async function handleBackupPut(request: Request, env: Env, account: Account): Promise<Response> {
  if (!isPaid(account)) return json({ error: 'subscription_required' }, 402);

  let body: { items?: unknown; device?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!body.items) return json({ error: 'missing_items' }, 400);

  const payload = JSON.stringify(body.items);

  if (account.userId.startsWith('plenum:')) {
    // Enforce 50MB total storage limit for Plenum SSO users (JSON payload + user uploaded files)
    const filesSizeRow = await env.DB.prepare(
      `SELECT COALESCE(SUM(size), 0) as total FROM user_files WHERE user_id = ?`
    )
      .bind(account.userId)
      .first<{ total: number }>();
    const currentFilesSize = filesSizeRow?.total ?? 0;
    const totalUsage = currentFilesSize + payload.length;
    const limit = 50 * 1024 * 1024; // 50MB
    if (totalUsage > limit) {
      return json({ error: 'storage_limit_reached', limit, usage: totalUsage }, 413);
    }
  } else {
    if (payload.length > MAX_BACKUP_BYTES) return json({ error: 'backup_too_large' }, 413);
  }

  let itemCount = 0;
  if (Array.isArray(body.items)) {
    itemCount = body.items.length;
  } else if (body.items && typeof body.items === 'object') {
    const obj = body.items as Record<string, unknown>;
    const itemsCount = Array.isArray(obj.items) ? obj.items.length : 0;
    const storageCount = Array.isArray(obj.storageItems) ? obj.storageItems.length : 0;
    itemCount = itemsCount + storageCount;
  }

  await env.DB.prepare(
    `INSERT INTO backups (user_id, payload, item_count, device, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       payload = excluded.payload,
       item_count = excluded.item_count,
       device = excluded.device,
       updated_at = datetime('now')`,
  )
    .bind(
      account.userId,
      payload,
      itemCount,
      typeof body.device === 'string' ? body.device.slice(0, 64) : null,
    )
    .run();

  return json({ ok: true, itemCount });
}

async function handleBackupGet(env: Env, account: Account): Promise<Response> {
  if (!isPaid(account)) return json({ error: 'subscription_required' }, 402);

  const row = await env.DB.prepare(
    `SELECT payload, item_count AS itemCount, updated_at AS updatedAt FROM backups WHERE user_id = ?`,
  )
    .bind(account.userId)
    .first<{ payload: string; itemCount: number; updatedAt: string }>();

  if (!row) return json({ items: [], itemCount: 0, updatedAt: null });

  let items: unknown;
  try {
    items = JSON.parse(row.payload);
  } catch {
    return json({ error: 'corrupt_backup' }, 500);
  }

  return json({ items, itemCount: row.itemCount, updatedAt: row.updatedAt });
}


/**
 * Grants premium to the signed-in account when the right code is presented.
 *
 * Server-side on purpose: a code checked in the app would be sitting in the
 * APK for anyone who unzips it. Here the secret never leaves Cloudflare, the
 * grant is tied to the account rather than the device, and it can be rotated
 * with one command.
 */
async function handleRedeem(request: Request, env: Env, account: Account): Promise<Response> {
  const expected = env.PROMO_CODE ?? '';
  if (!expected) return json({ error: 'redeem_disabled' }, 503);

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const supplied = typeof body.code === 'string' ? body.code.trim() : '';
  if (!supplied) return json({ error: 'missing_code' }, 400);

  // Constant-time compare so the response time can't be used to guess the code.
  const encoder = new TextEncoder();
  const a = encoder.encode(supplied);
  const b = encoder.encode(expected);
  const matches = a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);

  if (!matches) {
    console.log(JSON.stringify({ event: 'redeem_rejected', userId: account.userId }));
    return json({ error: 'invalid_code' }, 403);
  }

  await env.DB.prepare(
    `UPDATE entitlements SET plan = 'promo', expires_at = NULL, updated_at = datetime('now')
      WHERE user_id = ?`,
  )
    .bind(account.userId)
    .run();

  return json({ ok: true, plan: 'promo', paid: true });
}


/**
 * Called when the user saves an AI-filled item without correcting it — proof
 * the scan was good, and the point at which their free scan is spent.
 */
async function handleScanAccept(env: Env, account: Account): Promise<Response> {
  if (isPaid(account)) return json({ ok: true, charged: false });

  const freeLimit = Number(env.FREE_SCAN_LIMIT ?? '1');
  if (account.scansCharged >= freeLimit) return json({ ok: true, charged: false });

  await env.DB.prepare(
    `UPDATE usage SET ai_scans_charged = ai_scans_charged + 1 WHERE user_id = ?`,
  )
    .bind(account.userId)
    .run();

  return json({ ok: true, charged: true });
}

async function handleStorageUpload(request: Request, env: Env, account: Account): Promise<Response> {
  if (!account.userId.startsWith('plenum:')) {
    return json({ error: 'unsupported_user_type' }, 400);
  }

  let body: { name?: unknown; mimeType?: unknown; content?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const name = typeof body.name === 'string' ? body.name : 'upload';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'application/octet-stream';
  const content = typeof body.content === 'string' ? body.content : '';

  if (!content) return json({ error: 'missing_content' }, 400);

  let bytes: Uint8Array;
  try {
    const binaryString = atob(content);
    const len = binaryString.length;
    bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
  } catch {
    return json({ error: 'invalid_base64' }, 400);
  }

  const fileSize = bytes.length;

  // Enforce 50MB total storage limit (backup payload + user_files size)
  const filesSizeRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(size), 0) as total FROM user_files WHERE user_id = ?`
  )
    .bind(account.userId)
    .first<{ total: number }>();
  const currentFilesSize = filesSizeRow?.total ?? 0;

  const backupRow = await env.DB.prepare(
    `SELECT LENGTH(payload) as len FROM backups WHERE user_id = ?`
  )
    .bind(account.userId)
    .first<{ len: number }>();
  const backupSize = backupRow?.len ?? 0;

  const totalUsage = currentFilesSize + backupSize + fileSize;
  const limit = 50 * 1024 * 1024; // 50MB
  if (totalUsage > limit) {
    return json({ error: 'storage_limit_reached', limit, usage: totalUsage }, 413);
  }

  const fileId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_files (id, user_id, name, mime_type, content, size)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(fileId, account.userId, name, mimeType, bytes, fileSize)
    .run();

  const url = new URL(request.url);
  return json({
    id: fileId,
    name,
    mimeType,
    size: fileSize,
    url: `${url.origin}/storage/file/${fileId}`
  });
}

async function handleStorageFileGet(request: Request, env: Env, account: Account, fileId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT name, mime_type as mimeType, content, size FROM user_files WHERE id = ? AND user_id = ?`
  )
    .bind(fileId, account.userId)
    .first<{ name: string; mimeType: string; content: ArrayBuffer; size: number }>();

  if (!row) return json({ error: 'file_not_found' }, 404);

  return new Response(row.content, {
    headers: {
      'Content-Type': row.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(row.name)}"`,
      'Content-Length': String(row.size)
    }
  });
}

async function handleStorageFileDelete(env: Env, account: Account, fileId: string): Promise<Response> {
  await env.DB.prepare(
    `DELETE FROM user_files WHERE id = ? AND user_id = ?`
  )
    .bind(fileId, account.userId)
    .run();

  return json({ ok: true });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    try {
      const identity = await authenticate(request, env);
      if (!identity) return json({ error: 'unauthorized' }, 401);

      const account = await loadAccount(env, identity);

      if (url.pathname === '/me' && request.method === 'GET') {
        const freeLimit = Number(env.FREE_SCAN_LIMIT ?? '1');
        const paid = isPaid(account);
        return json({
          plan: account.plan,
          paid,
          expiresAt: account.expiresAt,
          scansUsed: account.scansUsed,
          // Remaining reflects accepted scans, but attempts still cap it.
          scansRemaining: paid
            ? null
            : Math.min(
                Math.max(0, freeLimit - account.scansCharged),
                Math.max(0, MAX_FREE_ATTEMPTS - account.scansUsed),
              ),
        });
      }

      if (url.pathname === '/scan' && request.method === 'POST') {
        return await handleScan(request, env, account);
      }

      if (url.pathname === '/scan/accept' && request.method === 'POST') {
        return await handleScanAccept(env, account);
      }

      if (url.pathname === '/redeem' && request.method === 'POST') {
        return await handleRedeem(request, env, account);
      }

      if (url.pathname === '/backup' && request.method === 'PUT') {
        return await handleBackupPut(request, env, account);
      }

      if (url.pathname === '/backup' && request.method === 'GET') {
        return await handleBackupGet(env, account);
      }

      if (url.pathname === '/storage/upload' && request.method === 'POST') {
        return await handleStorageUpload(request, env, account);
      }

      const fileMatch = url.pathname.match(/^\/storage\/file\/([a-f0-9-]+)$/);
      if (fileMatch) {
        const fileId = fileMatch[1];
        if (request.method === 'GET') {
          return await handleStorageFileGet(request, env, account, fileId);
        }
        if (request.method === 'DELETE') {
          return await handleStorageFileDelete(env, account, fileId);
        }
      }

      return json({ error: 'not_found' }, 404);
    } catch (error) {
      console.log(JSON.stringify({ event: 'unhandled', message: String(error) }));
      return json({ error: 'internal_error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
