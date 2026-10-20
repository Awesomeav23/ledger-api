-- The ledger: each transaction writes one debit and one credit of the
-- same amount, so all entries always sum to zero.
CREATE TABLE entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Both must point to rows that exist (foreign keys).
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  -- Money in whole cents ($12.34 = 1234) to avoid rounding errors.
  -- Always positive; the direction says which way the money moved.
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Speed up balance and history lookups by account, and lookups by transaction.
CREATE INDEX entries_account_id_idx ON entries(account_id);
CREATE INDEX entries_transaction_id_idx ON entries(transaction_id);
