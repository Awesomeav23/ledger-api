import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { HttpError } from "../errors";

export const accountsRouter = Router();

// Request body for creating an account. The name is trimmed and must be
// 1–100 characters. The currency must be 3 capital letters, default USD.
const createAccountSchema = z.object({
  ownerName: z.string().trim().min(1).max(100),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
});

// The :id in the URL must be a valid UUID.
const idParamSchema = z.object({ id: z.uuid() });

// Shape of an account row as it comes back from the database.
type AccountRow = { id: string; owner_name: string; currency: string; created_at: Date };

// Converts a database row (snake_case) into the API's JSON shape (camelCase).
function toAccountJson(row: AccountRow, balanceCents: number) {
  return {
    id: row.id,
    ownerName: row.owner_name,
    currency: row.currency,
    balanceCents,
    createdAt: row.created_at,
  };
}

// POST /accounts
// Creates an account and records it in the audit log.
accountsRouter.post("/accounts", async (req, res) => {
  const body = createAccountSchema.parse(req.body);
  const client = await pool.connect();
  try {
    // One transaction: the account and its audit row are saved together,
    // or neither is.
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO accounts (owner_name, currency) VALUES ($1, $2)
       RETURNING id, owner_name, currency, created_at`,
      [body.ownerName, body.currency],
    );
    const account = rows[0];
    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, payload)
       VALUES ('account.created', 'account', $1, $2)`,
      [account.id, JSON.stringify({ ownerName: body.ownerName, currency: body.currency })],
    );
    await client.query("COMMIT");
    // A new account has no entries, so its balance is 0.
    res.status(201).json(toAccountJson(account, 0));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// GET /accounts/:id
// Returns an account with its balance, calculated from its entries
// (credits minus debits, completed transactions only).
accountsRouter.get("/accounts/:id", async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { rows } = await pool.query(
    `SELECT a.id, a.owner_name, a.currency, a.created_at,
       COALESCE((
         SELECT SUM(CASE WHEN e.direction = 'credit' THEN e.amount_cents ELSE -e.amount_cents END)
         FROM entries e
         JOIN transactions t ON t.id = e.transaction_id
         WHERE e.account_id = a.id AND t.status = 'completed'
       ), 0) AS balance_cents
     FROM accounts a
     WHERE a.id = $1`,
    [id],
  );
  if (rows.length === 0) throw new HttpError(404, "account_not_found");
  // Postgres returns BIGINT sums as strings, so convert to a number.
  res.json(toAccountJson(rows[0], Number(rows[0].balance_cents)));
});

// GET /accounts
// Lists customer accounts with their balances, newest first.
// The system cash account is left out, since users never act on it.
accountsRouter.get("/accounts", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.owner_name, a.currency, a.created_at,
       COALESCE((
         SELECT SUM(CASE WHEN e.direction = 'credit' THEN e.amount_cents ELSE -e.amount_cents END)
         FROM entries e
         JOIN transactions t ON t.id = e.transaction_id
         WHERE e.account_id = a.id AND t.status = 'completed'
       ), 0) AS balance_cents
     FROM accounts a
     WHERE a.is_system = false
     ORDER BY a.created_at DESC
     LIMIT 200`,
  );
  res.json({ accounts: rows.map((r) => toAccountJson(r, Number(r.balance_cents))) });
});
