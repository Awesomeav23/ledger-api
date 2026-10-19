ALTER TABLE accounts ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;

INSERT INTO accounts (id, owner_name, currency, is_system)
VALUES ('00000000-0000-4000-8000-000000000001', 'SYSTEM_CASH', 'USD', true);
