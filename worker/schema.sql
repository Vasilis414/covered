CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',
  expires_at TEXT,
  play_token TEXT,
  -- Which store the subscription came from: 'apple' or 'google'.
  store TEXT,
  -- The store's stable id for the subscription itself, not one payment:
  -- Apple's original_transaction_id, Play's purchase token. Survives renewals.
  store_subscription_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/**
 * One subscription, one account.
 *
 * The uniqueness is the whole enforcement mechanism: a receipt already bound
 * to someone else cannot be bound again, so restoring a purchase under a
 * second account is refused rather than silently granting two accounts Pro.
 * Partial, because free accounts all have NULL here and NULLs must not collide.
 */
CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_store_subscription
  ON entitlements(store_subscription_id)
  WHERE store_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS usage (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ai_scans_used INTEGER NOT NULL DEFAULT 0,
  ai_scans_charged INTEGER NOT NULL DEFAULT 0,
  last_scan_at TEXT
);

CREATE TABLE IF NOT EXISTS backups (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  device TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_files (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  gcs_path TEXT,
  hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
CREATE INDEX IF NOT EXISTS idx_user_files_user_id ON user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_user_files_user_hash ON user_files(user_id, hash);

