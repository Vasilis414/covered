-- Binds a store subscription to exactly one account.
ALTER TABLE entitlements ADD COLUMN store TEXT;
ALTER TABLE entitlements ADD COLUMN store_subscription_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_store_subscription
  ON entitlements(store_subscription_id)
  WHERE store_subscription_id IS NOT NULL;
