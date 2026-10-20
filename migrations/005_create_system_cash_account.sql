-- Marks accounts that belong to the system, so the API can block users
-- from depositing into or transferring out of them.
ALTER TABLE accounts ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;

-- The system cash account. Deposits debit it, so its balance is negative
-- by the total amount of money that has entered the ledger.
-- Its ID is fixed so the code can always find it (see src/constants.ts).
INSERT INTO accounts (id, owner_name, currency, is_system)
VALUES ('00000000-0000-4000-8000-000000000001', 'SYSTEM_CASH', 'USD', true);
