import { verifyGoogleIdToken, type GoogleIdentity } from './google-auth';
import { verifyAppleIdentityToken } from './apple-auth';
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
- category: exactly one of Electronics, Appliance, Furniture, Vehicle, Tools,
  Service, Other. Use Service for anything sold as a term rather than an object
  — hosting, domain registration, subscriptions, insurance, extended cover,
  memberships, maintenance plans.
- warrantyMonths: how long this line is covered, in months.
  - If the line states its own period, use that and nothing else. Receipts write
    it as "Period: 5 Aug 2026 - 5 Aug 2028", "valid for 2 years", "(1 year)",
    "12 months" or "paid through 5 August 2027" — convert any of these to a
    month count, and prefer an explicit end date over a stated duration when
    both appear.
  - Otherwise, if the receipt states a warranty, use that. Extended-cover plans
    such as AppleCare+ are 24.
  - Otherwise use a sensible default for the product type.

Services count as purchases. A domain registration, a year of hosting, an
insurance policy or a support plan is exactly the kind of thing this app exists
to remind someone about, because it lapses on a stated date. Never drop a line
merely because it is not a physical object.

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
            enum: ['Electronics', 'Appliance', 'Furniture', 'Vehicle', 'Tools', 'Service', 'Other'],
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

/** Must match PRO_ENTITLEMENT_ID in the app's src/lib/subscriptions.ts. */
const PRO_ENTITLEMENT = 'Covered';

type Account = {
  userId: string;
  plan: string;
  expiresAt: string | null;
  /** 'apple' or 'google' when a store purchase backs this, else null. */
  store?: string | null;
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

  /**
   * A store subscription without an expiry is not trusted.
   *
   * `!expiresAt` used to mean "never expires", which is right for a promo
   * grant but dangerous for a purchase: if RevenueCat ever answered without an
   * expires_date, or a webhook arrived without expiration_at_ms, the row
   * became permanent Pro that no cancellation, refund or expiry could revoke —
   * and it would keep unlocking the account on any device it signed into.
   * Store-backed rows must carry a date; only a manual grant may be perpetual.
   */
  if (account.store && !account.expiresAt) return false;
  if (!account.expiresAt) return true;

  return new Date(account.expiresAt).getTime() > Date.now();
}

/** Finds or creates the account rows for a verified Google identity. */
async function loadAccount(env: Env, identity: GoogleIdentity): Promise<Account> {
  const existing = await env.DB.prepare(
    `SELECT u.id AS userId, COALESCE(e.plan,'free') AS plan, e.expires_at AS expiresAt,
            e.store AS store,
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
   * Sign in with Apple.
   *
   * Namespaced like the Plenum branch, so the same person signing in with
   * Google and with Apple stays two distinct accounts rather than colliding on
   * a bare `sub`. Apple only returns the email on the very first authorisation
   * and often returns a relay address, so whatever arrives here is persisted
   * on first sight and never expected again.
   */
  if (token.startsWith('apple:')) {
    const appleToken = token.slice('apple:'.length);
    const bundleIds = (env.APPLE_BUNDLE_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const identity = await verifyAppleIdentityToken(appleToken, bundleIds);
    if (!identity) return null;
    return {
      sub: 'apple:' + identity.sub,
      // A relay address is deliberately kept: it is deliverable, and it is the
      // only address Apple will ever give for this person.
      email: identity.email,
      name: undefined,
    };
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
/**
 * Where a store subscription lives, as far as this server is concerned.
 *
 * RevenueCat is the integration with Apple and Play, but it is keyed by its
 * own app user id and will happily move a receipt between them. This table is
 * the record of which *account* owns a subscription, so the answer survives
 * signing out, reinstalling, and switching devices.
 */
type StoreSubscription = {
  store: string;
  subscriptionId: string;
  productId: string;
  expiresAt: string | null;
};

/**
 * Asks RevenueCat what this account actually owns.
 *
 * Deliberately server-to-server rather than trusting a field from the app: the
 * client can claim anything, and the whole point of binding is that the claim
 * is checked.
 */
async function fetchStoreSubscription(
  env: Env,
  appUserId: string,
): Promise<StoreSubscription | null> {
  const key = env.REVENUECAT_SECRET_KEY;
  if (!key) return null;

  const res = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return null;

  const body = (await res.json()) as {
    subscriber?: {
      entitlements?: Record<string, { expires_date?: string | null; product_identifier?: string }>;
      subscriptions?: Record<string, Record<string, unknown>>;
    };
  };

  const entitlement = body.subscriber?.entitlements?.[PRO_ENTITLEMENT];
  if (!entitlement) return null;

  // An entitlement with no expiry is lifetime; one in the past is not active.
  const expiresAt = entitlement.expires_date ?? null;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return null;

  const productId = entitlement.product_identifier ?? '';
  const sub = body.subscriber?.subscriptions?.[productId] ?? {};

  /**
   * Prefer the id that survives renewals.
   *
   * Apple issues a fresh transaction id every renewal, so binding to that
   * would unbind the account every month. original_transaction_id is stable
   * for the life of the subscription; the others are fallbacks for stores and
   * API versions that do not return it.
   */
  const subscriptionId =
    (sub.original_transaction_id as string | undefined) ??
    (sub.store_transaction_id as string | undefined) ??
    (sub.original_purchase_date as string | undefined);
  if (!subscriptionId) return null;

  return {
    store: (sub.store as string | undefined) ?? 'unknown',
    subscriptionId,
    productId,
    expiresAt,
  };
}

/** Which account, if any, already owns this subscription. */
async function ownerOfSubscription(env: Env, subscriptionId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT user_id AS userId FROM entitlements WHERE store_subscription_id = ?`,
  )
    .bind(subscriptionId)
    .first<{ userId: string }>();
  return row?.userId ?? null;
}

/**
 * Binds the caller's store subscription to their account, or explains why not.
 *
 * Called after a purchase and after Restore Purchases. The conflict case is
 * the reason this exists: restoring under a second account must not hand that
 * account Pro as well, because one payment is one subscription.
 */
async function handleSubscriptionLink(env: Env, account: Account): Promise<Response> {
  const sub = await fetchStoreSubscription(env, account.userId);
  if (!sub) return json({ error: 'no_active_subscription' }, 404);

  /**
   * Refuse to record a subscription with no end date.
   *
   * Writing NULL here would create a row that never expires, and because the
   * account carries Pro to every device it signs into, that is a permanent
   * unlock bought once. Better to fail the link and let the client retry than
   * to grant something that cannot be taken back.
   */
  if (!sub.expiresAt) {
    return json({ error: 'subscription_missing_expiry' }, 502);
  }

  const owner = await ownerOfSubscription(env, sub.subscriptionId);
  if (owner && owner !== account.userId) {
    return json(
      {
        error: 'subscription_already_linked',
        message: 'This subscription is already connected to another account.',
      },
      409,
    );
  }

  await env.DB.prepare(
    `INSERT INTO entitlements (user_id, plan, expires_at, store, store_subscription_id, updated_at)
          VALUES (?, 'pro', ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
          plan = 'pro',
          expires_at = excluded.expires_at,
          store = excluded.store,
          store_subscription_id = excluded.store_subscription_id,
          updated_at = datetime('now')`,
  )
    .bind(account.userId, sub.expiresAt, sub.store, sub.subscriptionId)
    .run();

  return json({ ok: true, plan: 'pro', expiresAt: sub.expiresAt });
}

/**
 * Keeps the binding current as RevenueCat learns about renewals and endings.
 *
 * Without this the row would freeze at whatever /subscription/link saw, so a
 * cancelled subscription would keep granting Pro until its original expiry and
 * a renewal would expire early. Unauthenticated by design — RevenueCat calls
 * it — so the shared secret is the only thing standing in front of it.
 */
/**
 * Compares without leaking where two strings diverge.
 *
 * A plain !== returns as soon as it finds a difference, and the time that
 * takes is measurable across many attempts — enough to recover a secret byte
 * by byte. Constant work regardless of input closes that.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checks RevenueCat's HMAC-SHA256 over the raw request body. */
async function verifyHmac(secret: string, body: string, signature: string): Promise<boolean> {
  if (!signature) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return timingSafeEqual(hex.toLowerCase(), signature.trim().toLowerCase());
  } catch {
    return false;
  }
}

async function handleRevenueCatWebhook(request: Request, env: Env): Promise<Response> {
  const expected = env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) return json({ error: 'webhook_not_configured' }, 503);
  if (!timingSafeEqual(request.headers.get('Authorization') ?? '', expected)) {
    return json({ error: 'unauthorized' }, 401);
  }

  /**
   * Read once, as text, because the signature covers the exact bytes sent.
   *
   * Parsing to JSON and re-serialising would reorder keys and change spacing,
   * and the HMAC would never match.
   */
  const raw = await request.text();

  /**
   * Verified only when a signing secret is configured.
   *
   * Optional so the endpoint keeps working while HMAC signing is being turned
   * on in the dashboard — but once the secret is set, a request without a
   * valid signature is refused rather than quietly downgraded to header-only
   * auth, which would make enabling it pointless.
   */
  if (env.REVENUECAT_WEBHOOK_SIGNING_KEY) {
    const signature = request.headers.get('X-RevenueCat-Signature') ?? '';
    const ok = await verifyHmac(env.REVENUECAT_WEBHOOK_SIGNING_KEY, raw, signature);
    if (!ok) return json({ error: 'bad_signature' }, 401);
  }

  let body: { event?: Record<string, unknown> };
  try {
    body = JSON.parse(raw) as { event?: Record<string, unknown> };
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const event = body.event ?? {};
  const type = String(event.type ?? '');
  const appUserId = String(event.app_user_id ?? '');
  if (!appUserId) return json({ ok: true, ignored: 'no_app_user_id' });

  /**
   * Anonymous ids are not accounts.
   *
   * A purchase made before sign-in is keyed by RevenueCat's own anonymous id,
   * which matches no user row. Binding on it would write a row that no account
   * can ever claim; /subscription/link picks these up once the user signs in.
   */
  if (appUserId.startsWith('$RCAnonymousID:')) {
    return json({ ok: true, ignored: 'anonymous' });
  }

  const expiresAt = event.expiration_at_ms
    ? new Date(Number(event.expiration_at_ms)).toISOString()
    : null;
  const subscriptionId =
    (event.original_transaction_id as string | undefined) ??
    (event.transaction_id as string | undefined) ??
    null;

  /**
   * Ending events revoke, everything else grants.
   *
   * EXPIRATION and REFUND are the only ones that mean "no longer entitled".
   * CANCELLATION fires when auto-renew is switched off, which leaves the user
   * paid until the period actually ends — treating it as revocation would cut
   * off someone who has already paid for the rest of the month.
   */
  const revokes = type === 'EXPIRATION' || type === 'REFUND';

  if (revokes) {
    await env.DB.prepare(
      `UPDATE entitlements
          SET plan = 'free', expires_at = NULL, store_subscription_id = NULL,
              updated_at = datetime('now')
        WHERE user_id = ?`,
    )
      .bind(appUserId)
      .run();
    return json({ ok: true, type, plan: 'free' });
  }

  /**
   * A TRANSFER moves the receipt off whoever held it before.
   *
   * RevenueCat fires this when the same store account restores under a
   * different app user id. Clearing the old row keeps the unique index true
   * and stops the previous account from keeping Pro it no longer owns.
   */
  if (subscriptionId) {
    await env.DB.prepare(
      `UPDATE entitlements
          SET plan = 'free', expires_at = NULL, store_subscription_id = NULL,
              updated_at = datetime('now')
        WHERE store_subscription_id = ? AND user_id != ?`,
    )
      .bind(subscriptionId, appUserId)
      .run();
  }

  /**
   * Same rule as the link endpoint: no expiry, no grant.
   *
   * Answering ok stops RevenueCat retrying an event we have deliberately
   * declined; /subscription/link will pick the subscription up with a real
   * expiry the next time the app asks.
   */
  if (!expiresAt) {
    return json({ ok: true, type, ignored: 'missing_expiry' });
  }

  await env.DB.prepare(
    `INSERT INTO entitlements (user_id, plan, expires_at, store, store_subscription_id, updated_at)
          VALUES (?, 'pro', ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
          plan = 'pro',
          expires_at = excluded.expires_at,
          store = COALESCE(excluded.store, entitlements.store),
          store_subscription_id = COALESCE(excluded.store_subscription_id, entitlements.store_subscription_id),
          updated_at = datetime('now')`,
  )
    .bind(appUserId, expiresAt, String(event.store ?? 'unknown'), subscriptionId)
    .run();

  return json({ ok: true, type, plan: 'pro' });
}

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
      /**
       * Ahead of authenticate() on purpose: RevenueCat calls this, and it has
       * no Google identity to present. Its own shared secret guards it.
       */
      if (url.pathname === '/revenuecat/webhook' && request.method === 'POST') {
        return await handleRevenueCatWebhook(request, env);
      }

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
          // Identifies the account to RevenueCat so a subscription follows the
          // person who bought it rather than the handset it was bought on.
          userId: account.userId,
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

      if (url.pathname === '/subscription/link' && request.method === 'POST') {
        return await handleSubscriptionLink(env, account);
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
