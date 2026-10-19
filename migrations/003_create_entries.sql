CREATE TABLE entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX entries_account_id_idx ON entries(account_id);
CREATE INDEX entries_transaction_id_idx ON entries(transaction_id);
