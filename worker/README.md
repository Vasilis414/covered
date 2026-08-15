# covered-scan

Cloudflare Worker that proxies receipt scans to Gemini so the API key never
ships inside the app.

    GET  /me    -> { plan, paid, scansUsed, scansRemaining }
    POST /scan  -> { image: base64, mimeType } -> extracted receipt JSON

Both routes require `Authorization: Bearer <google-id-token>`.

## Remaining setup (needs a browser / your accounts)

1. `npx wrangler login`
2. Create OAuth client IDs in Google Cloud Console (Android, iOS, Web) and put
   them in `wrangler.jsonc` under `GOOGLE_CLIENT_IDS`, comma separated.
   Until this is set the Worker rejects every token — it fails closed.
3. `npx wrangler secret put GEMINI_API_KEY`
4. `npx wrangler deploy`
5. Point the app at it: `EXPO_PUBLIC_RECEIPT_AI_ENDPOINT=https://<worker-url>/scan`

## Database

D1 `covered-accounts` (id c18f9dcc-736e-41b4-b260-687881a61c13) — already
created, schema in `schema.sql` and already applied.
