-- Accounts that hold money. There is no balance column: a balance is
-- always calculated from the entries table, so it can't drift out of sync.
CREATE TABLE accounts (
  -- Random UUID, so account IDs can't be guessed by counting.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name TEXT NOT NULL,
  -- Three capital letters, e.g. USD.
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
