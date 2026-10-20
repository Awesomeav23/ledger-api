-- One row per money movement (a deposit or a transfer). The actual
-- debits and credits for it are stored in the entries table.
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE makes the database itself refuse a second transaction with
  -- the same key, which backs up the idempotency logic in the API.
  idempotency_key TEXT NOT NULL UNIQUE,
  -- Only completed transactions count toward balances.
  -- pending_review and rejected are for fraud review in Phase 4.
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending_review', 'completed', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
