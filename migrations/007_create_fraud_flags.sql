-- One row per fraud rule that flagged a transfer. A flagged transfer is
-- saved with status 'pending_review' and doesn't count toward balances
-- until someone approves it.
CREATE TABLE fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  -- Which rule fired, e.g. 'drains_balance'.
  rule TEXT NOT NULL,
  -- A readable explanation for whoever reviews the flag.
  reason TEXT NOT NULL,
  -- open = waiting for review; approved or rejected = decided.
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'approved', 'rejected')),
  -- When the flag was approved or rejected (empty while open).
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Speed up listing open flags, and finding the flags for a transaction.
CREATE INDEX fraud_flags_status_idx ON fraud_flags(status);
CREATE INDEX fraud_flags_transaction_id_idx ON fraud_flags(transaction_id);
