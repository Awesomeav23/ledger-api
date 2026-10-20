# Ledger API

A transaction ledger API with double-entry bookkeeping and fraud detection rules, built with TypeScript, Node.js/Express, and PostgreSQL.

## Features

- Accounts with balances calculated from ledger entries (no stored balance column)
- Deposits through a system cash account, so money never appears from nothing
- Transfers protected by row locking, so concurrent requests can't overspend an account
- Input validation with Zod and consistent JSON error responses
- Audit log for every account, deposit, and transfer
- Database constraints that block invalid data even if the API has a bug

## Design decisions

- **Integer cents:** money is stored as whole cents (BIGINT) to avoid floating-point rounding errors.
- **Double-entry:** every transaction writes a matching debit and credit, so all entries always sum to zero.
- **Calculated balances:** balance = credits minus debits for completed transactions, so it can't drift out of sync.
- **Row locking:** transfers lock both accounts with `SELECT ... FOR UPDATE`. In a test of 10 simultaneous $10 transfers from a $70 account, exactly 7 succeeded and 3 were rejected.
- **Deadlock prevention:** accounts are always locked in ID order.
- **Idempotency keys:** each transfer requires an `Idempotency-Key` header. A retry with the same key and body returns the original response instead of moving money again; the same key with a different body is rejected.
- **One database transaction per operation:** each request is fully saved or fully rolled back.

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | API and database status |
| POST | `/accounts` | Create an account |
| GET | `/accounts/:id` | Get an account and its balance |
| POST | `/deposits` | Deposit money into an account |
| POST | `/transfers` | Transfer money between accounts (requires `Idempotency-Key` header) |
| GET | `/accounts/:id/entries` | Paginated entry history for an account |

## Run locally

Requires Node.js 20+ and Docker.

    npm install
    cp .env.example .env
    npm run db:up
    npm run db:migrate
    npm run dev

Health check: `curl http://localhost:3010/health`

## Roadmap

### Phase 0: Project setup
- [x] TypeScript + Express API with strict type checking
- [x] PostgreSQL 16 in Docker Compose
- [x] Environment config with `.env` and `.env.example`
- [x] `GET /health` endpoint (returns 503 when the database is down)
- [x] ESLint and Prettier

### Phase 1: Schema and migrations
- [x] Migration runner that tracks applied files in `schema_migrations`
- [x] `accounts` table (UUID IDs, currency check)
- [x] `transactions` table (unique idempotency key, status check)
- [x] `entries` table (integer cents, debit/credit only, foreign keys, indexes)
- [x] `audit_log` table (JSONB payload)
- [x] Manual constraint tests for invalid currencies, duplicate keys, negative amounts, invalid directions, and missing accounts

### Phase 2: Core endpoints
- [x] Shared error handling (400 validation, 404 not found, 422 business rules, 500 unexpected)
- [x] `POST /accounts` and `GET /accounts/:id` with calculated balance
- [x] System cash account and `POST /deposits`
- [x] `POST /transfers` with row locking, deadlock-safe lock order, and insufficient funds check
- [x] Manual concurrency test: 10 simultaneous transfers, exactly 7 succeeded and 3 rejected
- [x] `GET /accounts/:id/entries` with cursor pagination

### Phase 3: Idempotency
- [x] Require an `Idempotency-Key` header on `POST /transfers`
- [x] Return the original result when the same key is sent again, instead of creating a second transfer
- [x] Test that a repeated request creates only one transfer

### Phase 4: Fraud rules
- [ ] Rule engine where each rule returns flag or pass
- [ ] Rule: large transfer from an account less than 24 hours old
- [ ] Rule: more than five transfers from one account within one minute
- [ ] Rule: transfer that moves over 90% of the balance
- [ ] `fraud_flags` table, with flagged transfers held as `pending_review`
- [ ] `GET /flags`, `POST /flags/:id/approve`, and `POST /flags/:id/reject`

### Phase 5: Automated tests and CI
- [ ] Unit tests for fraud rules and balance math
- [ ] Integration tests against a real PostgreSQL container
- [ ] Tests for insufficient funds, repeated idempotency keys, and validation errors
- [ ] Automated concurrency test (parallel transfers never push a balance below zero)
- [ ] Automated ledger check (all entries sum to zero)
- [ ] GitHub Actions workflow with a PostgreSQL service container

### Phase 6: Deployment and admin page
- [ ] Deploy the API and PostgreSQL (Render, Railway, or Fly.io)
- [ ] React admin page: accounts, transfers, and a flag review queue
- [ ] Architecture diagram in this README
- [ ] Live demo link

## Progress log

### After Phase 2: Core endpoints

What the API can do:
- Create accounts and get each account's balance, calculated from ledger entries
- Deposit money into an account through the system cash account
- Transfer money between accounts, safely under concurrent requests
- Show an account's full debit and credit history, newest first, with cursor pagination
- Return clear errors: 400 for invalid input, 404 for missing accounts, 422 for insufficient funds

Verified manually:
- 10 simultaneous $10 transfers from a $70 account: 7 succeeded, 3 were rejected, and the balance ended at exactly $0
- All ledger entries sum to zero after deposits and transfers
- Pagination returns every entry exactly once across pages, even when entries share the same millisecond
- Transfers to the same account, transfers involving the system account, decimal amounts, and broken cursors are all rejected

### After Phase 3: Idempotency

What the API can do:
- Require an `Idempotency-Key` header on every transfer
- Return the original response for a retried transfer, marked with an `Idempotent-Replayed: true` header, without moving money again
- Reject a reused key sent with a different body (422 `idempotency_key_reused`)
- Reject transfers that have no key (400 `idempotency_key_required`)

Verified manually:
- A retried transfer returned the same transaction ID, and balances changed only once
- 5 identical requests sent at the same time all returned 201, but money moved only once
