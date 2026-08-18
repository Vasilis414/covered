import { verifyGoogleIdToken, type GoogleIdentity } from './google-auth';
import { getGcsAccessToken, uploadToGcs, downloadFromGcs, deleteFromGcs } from './gcs';

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

The file may be a photo of a receipt or a PDF receipt or invoice. The photo may
be rotated ninety or a hundred and eighty degrees, and the paper may be creased
or curled — read the text in whatever orientation it runs.

Receipts may be in any language and any script. Keep each description in the
language it is printed in; do not translate it.

Extract every physical product or service that was actually purchased. Ignore
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

Numbers: much of the world writes decimals with a comma. "5,70" is 5.70 and
"1.234,56" is 1234.56. Always return JSON numbers with a decimal point.

Also extract the shop name, the purchase date as YYYY-MM-DD, and the grand total.
The date is often written out in the receipt's own language, for example
"Σάββατο, Αυγούστου 15, 2026", "15 août 2026" or "15/08/2026" — convert any of
these to YYYY-MM-DD. Where a numeric date is ambiguous, assume day before month
unless the receipt is clearly from the United States.

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
          claimUrl: { type: 'string' },
        },
        required: ['description', 'price'],
      },
    },
  },
} as const;

const STORAGE_SCAN_PROMPT = `You are an AI document, barcode and ticket scanner for a mobile storage vault.
The uploaded file is a ticket, parking receipt/pass, loyalty card, barcode card, transit pass, event ticket, or document.

Analyze the image and extract:
1. name: A clear, concise title (e.g. "Airport Terminal 2 Parking", "IKEA Family Card", "Coldplay Concert Ticket", "Zara Return Receipt").
2. type: Exactly one of: "ticket", "receipt", "barcode", "other".
   - "ticket": parking tickets, event tickets, boarding passes, cinema tickets, transit passes.
   - "receipt": shopping receipts, invoices, proof of purchase.
   - "barcode": member cards, loyalty cards, library cards, gift cards.
   - "other": documents, certificates, notes.
3. barcodePayload: Read only the digits or text PRINTED beside or beneath the code as ink. Do not try to decode the code graphic itself — a dedicated on-device decoder does that, and a guess here is worse than nothing. If no such printed text exists, omit this field.
4. barcodeFormat: The format if detected: "QR_CODE", "CODE_128", "EAN_13", "CODE_39", "PDF417", or "OTHER".
5. expiresAt: Only when the document explicitly states a deadline — "valid until", "expires", "return by", or an event start time (parking valid until 2026-08-15 22:30, concert at 2026-09-12 20:00). Output ISO 8601: "YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DD". Never derive it from the time the document was issued: a shop receipt printed at 23:05 does not expire at 23:05. If nothing states a deadline, omit this field.
6. notes: Brief extracted metadata (e.g. "Zone B Space 44", "Gate 14, Seat 22A", "Card Number: 9876 5432").`;

const STORAGE_SCAN_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: {
      type: 'string',
      enum: ['ticket', 'receipt', 'barcode', 'other'],
    },
    barcodePayload: { type: 'string' },
    barcodeFormat: {
      type: 'string',
      enum: ['QR_CODE', 'CODE_128', 'EAN_13', 'CODE_39', 'PDF417', 'OTHER'],
    },
    expiresAt: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['name', 'type'],
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

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...extraHeaders,
    },
  });
}

function isPaid(account: Account): boolean {
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
      const response = await fetch('https://plenum.gr/oauth/userinfo', {
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

/**
 * Asks Gemini to read an image, trying the Interactions API first and falling
 * back to the older generateContent endpoint.
 *
 * The order matters. Gemini 3.x models are only reachable through Interactions;
 * generateContent answers `not_found` for them, so leading with it spent a
 * failed round trip on every single scan. The fallback stays because it is the
 * only path for older models, should the configured one ever change back.
 */
async function queryGemini(
  apiKey: string,
  modelName: string,
  prompt: string,
  schema: unknown,
  image: string,
  mimeType: string,
): Promise<{ ok: boolean; parsed?: unknown; status: number; error?: string }> {
  const viaInteractions = await queryInteractions(apiKey, modelName, prompt, schema, image, mimeType);
  if (viaInteractions.ok) return viaInteractions;

  const viaGenerate = await queryGenerateContent(apiKey, modelName, prompt, schema, image, mimeType);
  // Report whichever failure is more informative: the legacy endpoint's
  // not_found for a 3.x model says nothing useful about the real problem.
  return viaGenerate.ok ? viaGenerate : viaInteractions;
}

async function queryGenerateContent(
  apiKey: string,
  modelName: string,
  prompt: string,
  schema: unknown,
  image: string,
  mimeType: string,
): Promise<{ ok: boolean; parsed?: unknown; status: number; error?: string }> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: image,
                },
              },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          response_schema: schema,
        },
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        try {
          return { ok: true, parsed: JSON.parse(text), status: res.status };
        } catch {
          // ignore and try next
        }
      }
    }

    if (res.status === 429) {
      return { ok: false, status: 429, error: 'rate_limited' };
    }
    return { ok: false, status: res.status, error: await res.text().catch(() => '') };
  } catch (err) {
    console.log(JSON.stringify({ event: 'generateContent_failed', error: String(err) }));
    return { ok: false, status: 500, error: String(err) };
  }
}

async function queryInteractions(
  apiKey: string,
  modelName: string,
  prompt: string,
  schema: unknown,
  image: string,
  mimeType: string,
): Promise<{ ok: boolean; parsed?: unknown; status: number; error?: string }> {
  try {
    const interactionsUrl = 'https://generativelanguage.googleapis.com/v1/interactions';
    const intRes = await fetch(interactionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model: modelName,
        store: false,
        input: [
          {
            type: 'user_input',
            content: [
              { type: 'image', mime_type: mimeType, data: image },
              { type: 'text', text: prompt },
            ],
          },
        ],
        response_format: [{ type: 'text', mime_type: 'application/json', schema }],
      }),
    });

    if (intRes.ok) {
      const payload = (await intRes.json()) as {
        steps?: { type?: string; content?: { text?: string }[] }[];
      };
      const text = (payload.steps ?? [])
        .filter((step) => step.type === 'model_output')
        .flatMap((step) => step.content ?? [])
        .map((part) => part.text)
        .filter(Boolean)
        .join('');
      if (text) {
        try {
          return { ok: true, parsed: JSON.parse(text), status: intRes.status };
        } catch {
          // ignore
        }
      }
    }

    const errBody = await intRes.text().catch(() => '');
    return { ok: false, status: intRes.status, error: errBody };
  } catch (err) {
    return { ok: false, status: 500, error: String(err) };
  }
}

async function handleScan(request: Request, env: Env, account: Account): Promise<Response> {
  const freeLimit = Number(env.FREE_SCAN_LIMIT ?? '1');

  /**
   * Two separate ceilings, and both are needed.
   *
   * `scansCharged` is the real allowance: a scan only counts once the user
   * saved it unedited, so a bad read doesn't burn their one free try.
   * `scansUsed` counts raw attempts, because without it editing a single
   * character would buy unlimited scanning.
   */
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

  const modelName = env.GEMINI_MODEL || 'gemini-2.5-flash';

  let outcome = await queryGemini(env.GEMINI_API_KEY, modelName, PROMPT, RESPONSE_SCHEMA, image, mimeType);

  // Failover to secondary paid key if rate-limited
  if ((!outcome.ok || outcome.status === 429) && env.GEMINI_FALLBACK_API_KEY) {
    console.log(JSON.stringify({ event: 'gemini_fallback_triggered', status: outcome.status }));
    outcome = await queryGemini(env.GEMINI_FALLBACK_API_KEY, modelName, PROMPT, RESPONSE_SCHEMA, image, mimeType);
  }

  if (!outcome.ok || !outcome.parsed) {
    console.log(JSON.stringify({ event: 'gemini_scan_failed', status: outcome.status, error: outcome.error }));
    return json({ error: 'upstream_failed', details: outcome.error }, 502);
  }

  // Count the attempt now; whether it *costs* them a free scan is decided
  // later, when they either save the result as-is or correct it.
  await env.DB.prepare(
    `UPDATE usage SET ai_scans_used = ai_scans_used + 1, last_scan_at = datetime('now')
      WHERE user_id = ?`,
  )
    .bind(account.userId)
    .run();

  return json(outcome.parsed);
}

async function handleStorageScan(request: Request, env: Env, account: Account): Promise<Response> {
  if (!isPaid(account)) {
    return json({ error: 'subscription_required' }, 402);
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
  if ((image.length * 3) / 4 > MAX_UPLOAD_BYTES) return json({ error: 'image_too_large' }, 413);

  const modelName = env.GEMINI_MODEL || 'gemini-2.5-flash';

  let outcome = await queryGemini(env.GEMINI_API_KEY, modelName, STORAGE_SCAN_PROMPT, STORAGE_SCAN_SCHEMA, image, mimeType);

  if ((!outcome.ok || outcome.status === 429) && env.GEMINI_FALLBACK_API_KEY) {
    console.log(JSON.stringify({ event: 'gemini_storage_fallback_triggered', status: outcome.status }));
    outcome = await queryGemini(env.GEMINI_FALLBACK_API_KEY, modelName, STORAGE_SCAN_PROMPT, STORAGE_SCAN_SCHEMA, image, mimeType);
  }

  if (!outcome.ok || !outcome.parsed) {
    console.log(JSON.stringify({ event: 'gemini_storage_failed', status: outcome.status, error: outcome.error }));
    return json({ error: 'upstream_failed', details: outcome.error }, 502);
  }

  return json(outcome.parsed);
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

  if (account.userId.startsWith('plenum:') || isPaid(account)) {
    // Enforce 500MB total storage limit for server-backed users (JSON payload + user uploaded files)
    const filesSizeRow = await env.DB.prepare(
      `SELECT COALESCE(SUM(size), 0) as total FROM user_files WHERE user_id = ?`
    )
      .bind(account.userId)
      .first<{ total: number }>();
    const currentFilesSize = filesSizeRow?.total ?? 0;
    const totalUsage = currentFilesSize + payload.length;
    const limit = 500 * 1024 * 1024; // 500MB
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

  // Prune orphaned user_files created more than 24h ago that are no longer referenced in the catalog
  try {
    const referencedFileIds = new Set<string>();
    const matches = payload.matchAll(/\/storage\/file\/([a-f0-9-]+)/g);
    for (const match of matches) {
      referencedFileIds.add(match[1]);
    }

    const oldFiles = await env.DB.prepare(
      `SELECT id, gcs_path as gcsPath FROM user_files WHERE user_id = ? AND datetime(created_at) < datetime('now', '-1 day')`
    )
      .bind(account.userId)
      .all<{ id: string; gcsPath: string | null }>();

    if (oldFiles.results && oldFiles.results.length > 0) {
      const orphaned = oldFiles.results.filter(f => !referencedFileIds.has(f.id));
      if (orphaned.length > 0) {
        const gcsToken = await getGcsAccessToken(env.GCS_SERVICE_ACCOUNT_KEY);
        for (const orphan of orphaned) {
          if (orphan.gcsPath) {
            const refCount = await env.DB.prepare(
              `SELECT COUNT(*) as cnt FROM user_files WHERE gcs_path = ? AND id != ?`
            )
              .bind(orphan.gcsPath, orphan.id)
              .first<{ cnt: number }>();

            if ((refCount?.cnt ?? 0) === 0) {
              await deleteFromGcs(env.GCS_BUCKET_NAME, orphan.gcsPath, gcsToken).catch(() => {});
            }
          }
          await env.DB.prepare(`DELETE FROM user_files WHERE id = ? AND user_id = ?`)
            .bind(orphan.id, account.userId)
            .run();
        }
      }
    }
  } catch (err) {
    console.warn('Orphaned files pruning error:', err);
  }

  return json({ ok: true, itemCount });
}

async function handleBackupGet(env: Env, account: Account): Promise<Response> {
  if (!isPaid(account)) return json({ error: 'subscription_required' }, 402);

  const row = await env.DB.prepare(
    `SELECT payload, item_count AS itemCount, device, updated_at AS updatedAt
       FROM backups
      WHERE user_id = ?`,
  )
    .bind(account.userId)
    .first<{ payload: string; itemCount: number; device: string | null; updatedAt: string }>();

  if (!row) return json({ items: null, itemCount: 0, updatedAt: null, device: null });

  let items: unknown = null;
  try {
    items = JSON.parse(row.payload);
  } catch {
    items = null;
  }

  return json({
    items,
    itemCount: row.itemCount,
    updatedAt: row.updatedAt,
    device: row.device,
  });
}


/**
 * Grants premium to the signed-in account when the right code is presented.
 *
 * Server-side on purpose: a code checked in the app would be sitting in the
 * APK for anyone who unzips it. Here the secret never leaves Cloudflare, the
 * grant is tied to the account rather than the device, and it can be rotated
 * with one command.
 */
/**
 * Deletes the account and everything belonging to it.
 *
 * Required by both stores for any app that lets people create an account, and
 * it has to be real: rows, backup payload and the uploaded files themselves.
 * Stored objects are shared by hash, so an object is only removed from GCS once
 * no other account still references it.
 */
async function handleAccountDelete(env: Env, account: Account): Promise<Response> {
  const files = await env.DB.prepare(
    `SELECT id, gcs_path AS gcsPath, hash FROM user_files WHERE user_id = ?`,
  )
    .bind(account.userId)
    .all<{ id: string; gcsPath: string | null; hash: string | null }>();

  /**
   * The access token is fetched once, not per file. Workers allow 50
   * subrequests per invocation on the free plan, and minting a token inside
   * the loop spent one of those on every attachment — an account with twenty
   * files would have hit the ceiling and failed halfway through a deletion.
   */
  let gcsToken: string | null = null;

  for (const file of files.results ?? []) {
    if (!file.gcsPath) continue;
    try {
      const others = await env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM user_files WHERE gcs_path = ? AND user_id != ?`,
      )
        .bind(file.gcsPath, account.userId)
        .first<{ cnt: number }>();

      if ((others?.cnt ?? 0) === 0) {
        gcsToken ??= await getGcsAccessToken(env.GCS_SERVICE_ACCOUNT_KEY);
        await deleteFromGcs(env.GCS_BUCKET_NAME, file.gcsPath, gcsToken);
      }
    } catch {
      // A stored object we cannot remove must not block the account deletion —
      // the user's request to be gone outranks tidy storage.
    }
  }

  // entitlements and usage cascade from users; backups and user_files do not.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM backups WHERE user_id = ?`).bind(account.userId),
    env.DB.prepare(`DELETE FROM user_files WHERE user_id = ?`).bind(account.userId),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(account.userId),
  ]);

  return json({ ok: true, deleted: (files.results ?? []).length });
}

async function handleRedeem(request: Request, env: Env, account: Account): Promise<Response> {
  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const supplied = typeof body.code === 'string' ? body.code.trim() : '';
  if (!supplied) return json({ error: 'missing_code' }, 400);

  const expected = env.PROMO_CODE ?? '';
  if (!expected || !timingSafeEquals(supplied, expected)) {
    return json({ error: 'invalid_code' }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO entitlements (user_id, plan, expires_at, updated_at)
     VALUES (?, 'promo', NULL, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       plan = 'promo',
       expires_at = NULL,
       updated_at = datetime('now')`,
  )
    .bind(account.userId)
    .run();

  return json({ ok: true, plan: 'promo' });
}


/**
 * Called when the user saves an AI-filled item without correcting it — proof
 * the scan was good, and the point at which their free scan is spent.
 */
async function handleScanAccept(env: Env, account: Account): Promise<Response> {
  if (isPaid(account)) return json({ ok: true });

  await env.DB.prepare(
    `UPDATE usage
        SET ai_scans_charged = ai_scans_charged + 1
      WHERE user_id = ?`,
  )
    .bind(account.userId)
    .run();

  return json({ ok: true });
}

async function handleStorageUpload(request: Request, env: Env, account: Account): Promise<Response> {
  if (!isPaid(account)) {
    return json({ error: 'subscription_required' }, 402);
  }

  const rawName = request.headers.get('X-File-Name') || 'upload';
  const name = decodeURIComponent(rawName).slice(0, 255); // Bound filename length
  const mimeType = request.headers.get('Content-Type') || 'application/octet-stream';
  
  if (!ALLOWED_MIME.has(mimeType)) {
    return json({ error: 'unsupported_type' }, 415);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return json({ error: 'missing_content' }, 400);
  if (bytes.length > MAX_UPLOAD_BYTES) return json({ error: 'file_too_large' }, 413);

  const fileSize = bytes.length;

  // Enforce 500MB total storage limit (backup payload + user_files size)
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
  const limit = 500 * 1024 * 1024; // 500MB
  if (totalUsage > limit) {
    return json({ error: 'storage_limit_reached', limit, usage: totalUsage }, 413);
  }

  // SHA-256 content deduplication check
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const existingFile = await env.DB.prepare(
    `SELECT gcs_path as gcsPath FROM user_files WHERE hash = ? AND user_id = ? AND gcs_path IS NOT NULL LIMIT 1`
  )
    .bind(hashHex, account.userId)
    .first<{ gcsPath: string }>();

  let gcsPath = existingFile?.gcsPath;
  const fileId = crypto.randomUUID();

  if (!gcsPath) {
    gcsPath = `users/${account.userId}/${fileId}`;
    const gcsToken = await getGcsAccessToken(env.GCS_SERVICE_ACCOUNT_KEY);
    await uploadToGcs(env.GCS_BUCKET_NAME, gcsPath, bytes, mimeType, gcsToken);
  }

  // Store metadata only in D1 (no BLOB)
  await env.DB.prepare(
    `INSERT INTO user_files (id, user_id, name, mime_type, size, gcs_path, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(fileId, account.userId, name, mimeType, fileSize, gcsPath, hashHex)
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
    `SELECT name, mime_type as mimeType, size, gcs_path as gcsPath, hash FROM user_files WHERE id = ? AND user_id = ?`
  )
    .bind(fileId, account.userId)
    .first<{ name: string; mimeType: string; size: number; gcsPath: string | null; hash: string | null }>();

  if (!row) return json({ error: 'file_not_found' }, 404);

  const etag = `"${row.hash || fileId}"`;
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      }
    });
  }

  // If the file has a GCS path, stream from GCS. Otherwise fall back to D1
  if (row.gcsPath) {
    const gcsToken = await getGcsAccessToken(env.GCS_SERVICE_ACCOUNT_KEY);
    const { data, contentType } = await downloadFromGcs(env.GCS_BUCKET_NAME, row.gcsPath, gcsToken);
    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(row.name)}"`,
        'Content-Length': String(data.byteLength),
        'ETag': etag,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      }
    });
  }

  // Legacy fallback: file stored as D1 BLOB
  const legacy = await env.DB.prepare(
    `SELECT content FROM user_files WHERE id = ? AND user_id = ?`
  )
    .bind(fileId, account.userId)
    .first<{ content: ArrayBuffer }>();

  if (!legacy?.content) return json({ error: 'file_not_found' }, 404);

  return new Response(legacy.content, {
    headers: {
      'Content-Type': row.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(row.name)}"`,
      'Content-Length': String(row.size),
      'ETag': etag,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    }
  });
}

async function handleStorageFileDelete(env: Env, account: Account, fileId: string): Promise<Response> {
  // Look up the GCS path before deleting the metadata row.
  const row = await env.DB.prepare(
    `SELECT gcs_path as gcsPath FROM user_files WHERE id = ? AND user_id = ?`
  )
    .bind(fileId, account.userId)
    .first<{ gcsPath: string | null }>();

  if (row?.gcsPath) {
    // Check if any other records share this gcsPath before deleting the underlying object
    const refCount = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM user_files WHERE gcs_path = ? AND id != ?`
    )
      .bind(row.gcsPath, fileId)
      .first<{ cnt: number }>();

    if ((refCount?.cnt ?? 0) === 0) {
      const gcsToken = await getGcsAccessToken(env.GCS_SERVICE_ACCOUNT_KEY);
      await deleteFromGcs(env.GCS_BUCKET_NAME, row.gcsPath, gcsToken);
    }
  }

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

        let storageUsed = 0;
        if (paid) {
          const filesSizeRow = await env.DB.prepare(
            `SELECT COALESCE(SUM(size), 0) as total FROM user_files WHERE user_id = ?`
          )
            .bind(account.userId)
            .first<{ total: number }>();
          
          const backupRow = await env.DB.prepare(
            `SELECT LENGTH(payload) as len FROM backups WHERE user_id = ?`
          )
            .bind(account.userId)
            .first<{ len: number }>();

          storageUsed = (filesSizeRow?.total ?? 0) + (backupRow?.len ?? 0);
        }

        return json({
          plan: account.plan,
          paid,
          expiresAt: account.expiresAt,
          scansUsed: account.scansUsed,
          scansRemaining: paid
            ? null
            : Math.min(
                Math.max(0, freeLimit - account.scansCharged),
                Math.max(0, MAX_FREE_ATTEMPTS - account.scansUsed),
              ),
          storageUsed,
          storageLimit: 500 * 1024 * 1024, // 500MB
          email: identity.email ?? null,
        });
      }

      if (url.pathname === '/scan' && request.method === 'POST') {
        return await handleScan(request, env, account);
      }

      if (url.pathname === '/scan/accept' && request.method === 'POST') {
        return await handleScanAccept(env, account);
      }

      if (url.pathname === '/account' && request.method === 'DELETE') {
        return await handleAccountDelete(env, account);
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

      if (url.pathname === '/storage/scan' && request.method === 'POST') {
        return await handleStorageScan(request, env, account);
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
