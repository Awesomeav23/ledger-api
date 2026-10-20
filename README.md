# Ledger API

[![CI](https://github.com/Awesomeav23/ledger-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Awesomeav23/ledger-api/actions/workflows/ci.yml)

A transaction ledger API with double-entry bookkeeping and fraud detection rules, built with TypeScript, Node.js/Express, and PostgreSQL.

## Features

- Accounts with balances calculated from ledger entries (no stored balance column)
- Deposits through a system cash account, so money never appears from nothing
- Transfers protected by row locking, so concurrent requests can't overspend an account
- Input validation with Zod and consistent JSON error responses
- Audit log for every account, deposit, and transfer
- Fraud rules that hold suspicious transfers for review instead of completing them
- Database constraints that block invalid data even if the API has a bug

## Design decisions

- **Integer cents:** money is stored as whole cents (BIGINT) to avoid floating-point rounding errors.
- **Double-entry:** every transaction writes a matching debit and credit, so all entries always sum to zero.
- **Calculated balances:** balance = credits minus debits for completed transactions, so it can't drift out of sync.
- **Row locking:** transfers lock both accounts with `SELECT ... FOR UPDATE`. In a test of 10 simultaneous $10 transfers from a $70 account, exactly 7 succeeded and 3 were rejected.
- **Deadlock prevention:** accounts are always locked in ID order.
- **Idempotency keys:** each transfer requires an `Idempotency-Key` header. A retry with the same key and body returns the original response instead of moving money again; the same key with a different body is rejected.
- **Fraud rules:** each transfer is checked against three rules (large transfer from a new account, more than 5 transfers in a minute, moving over 90% of the balance). A flagged transfer is saved as `pending_review` and only counts toward balances once approved.
- **One database transaction per operation:** each request is fully saved or fully rolled back.

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | API and database status |
| POST | `/accounts` | Create an account |
| GET | `/accounts` | List customer accounts with balances, newest first |
| GET | `/accounts/:id` | Get an account and its balance |
| POST | `/deposits` | Deposit money into an account |
| POST | `/transfers` | Transfer money between accounts (requires `Idempotency-Key` header) |
| GET | `/accounts/:id/entries` | Paginated entry history for an account |
| GET | `/flags` | List fraud flags (open by default; `?status=approved` or `rejected`) |
| POST | `/flags/:id/approve` | Approve a held transfer, after re-checking the balance |
| POST | `/flags/:id/reject` | Reject a held transfer so its money never moves |

## Run locally

Requires Node.js 20+ and Docker.

    npm install
    cp .env.example .env
    npm run db:up
    npm run db:migrate
    npm run dev

Health check: `curl http://localhost:3010/health`

## Admin page

A React app in `web/` for managing the ledger: view accounts and balances, open accounts, add money, send transfers, and approve or reject held transfers.

    cd web && npm install && cd ..
    npm run dev:all

Then open http://localhost:5180. `dev:all` starts the API and the admin page together; the admin page forwards `/api` requests to the API on port 3010.


## Tests

One-time setup: create and migrate a separate test database.

    docker exec ledger-db psql -U ledger -d ledger -c "CREATE DATABASE ledger_test;"
    npm run db:migrate:test

Run the suite (39 tests: fraud rules, accounts, deposits, transfers, concurrency, idempotency, flag review, ledger integrity):

    npm test

GitHub Actions runs lint, build, migrations, and the full suite against a fresh PostgreSQL database on every push.

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
- [x] Rule engine where each rule returns flag or pass
- [x] Rule: large transfer from an account less than 24 hours old
- [x] Rule: more than five transfers from one account within one minute
- [x] Rule: transfer that moves over 90% of the balance
- [x] `fraud_flags` table, with flagged transfers held as `pending_review`
- [x] `GET /flags`, `POST /flags/:id/approve`, and `POST /flags/:id/reject`

### Phase 5: Automated tests and CI
- [x] Unit tests for fraud rules and balance math
- [x] Integration tests against a real PostgreSQL container
- [x] Tests for insufficient funds, repeated idempotency keys, and validation errors
- [x] Automated concurrency test (parallel transfers never push a balance below zero)
- [x] Automated ledger check (all entries sum to zero)
- [x] GitHub Actions workflow with a PostgreSQL service container

### Phase 6: Deployment and admin page
- [ ] Deploy the API and PostgreSQL (Render, Railway, or Fly.io)
- [x] React admin page: accounts, transfers, and a flag review queue
- [ ] Architecture diagram in this README
- [ ] Live demo link

## Progress log

### After Phase 0: Project setup

What the API can do:
- Run locally with PostgreSQL in Docker and the API with `npm run dev`
- Report its status at `GET /health`: `ok` when the database is reachable, 503 when it isn't

Verified manually:
- The health check returned 503 with the database stopped, and `ok` after restarting it
- Lint and the TypeScript build pass

### After Phase 1: Schema and migrations

What the database can do:
- Store accounts, transactions, ledger entries, and an audit log
- Apply schema changes with `npm run db:migrate`, which runs only new migration files
- Enforce data rules itself, even if the API code has a bug

Verified manually:
- The database rejected a lowercase currency, a duplicate idempotency key, an unknown status, a negative amount, an invalid direction, and an entry for an account that doesn't exist
- A valid entry was accepted
- The migration runner skipped files that had already been applied

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

### After Phase 4: Fraud rules

What the API can do:
- Check every transfer against three fraud rules before completing it
- Hold flagged transfers as `pending_review` (202 Accepted) without changing any balance
- List open, approved, or rejected flags with each transfer's accounts and amount
- Approve a held transfer after re-checking the sender's balance, or reject it so its money never moves

Verified manually:
- A $65 transfer from a $70 balance was flagged, then approved, and both balances updated
- A $90 transfer from a $95 balance was flagged, then rejected, and neither balance changed
- The 6th transfer within one minute was flagged for high velocity
- A $600 transfer from a minutes-old account was flagged, while the drain rule correctly stayed quiet
- Approving the same flag twice was refused (409)
- All completed entries still sum to zero

### After Phase 5: Automated tests and CI

What the project can do:
- Run 39 automated tests with `npm test`, against a separate test database that never touches development data
- Run lint, build, migrations, and the full test suite on GitHub Actions for every push

Covered by the tests:
- Every fraud rule, including just-below-the-limit cases (5th vs. 6th transfer, exactly 90% vs. over 90%)
- Account creation, validation errors, and audit log entries
- Deposits, transfers, insufficient funds, and invalid transfers
- 5 simultaneous transfers from one account: exactly 3 succeed and the balance never goes negative
- Retries, reused keys, and 5 simultaneous identical requests moving money only once
- Holding, approving, and rejecting flagged transfers, including refusing an approval after the money was spent
- All completed entries summing to zero
