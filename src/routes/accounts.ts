import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { HttpError } from "../errors";

export const accountsRouter = Router();

const createAccountSchema = z.object({
  ownerName: z.string().trim().min(1).max(100),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
});

const idParamSchema = z.object({ id: z.uuid() });

type AccountRow = { id: string; owner_name: string; currency: string; created_at: Date };

function toAccountJson(row: AccountRow, balanceCents: number) {
  return {
    id: row.id,
    ownerName: row.owner_name,
    currency: row.currency,
    balanceCents,
    createdAt: row.created_at,
  };
}

accountsRouter.post("/accounts", async (req, res) => {
  const body = createAccountSchema.parse(req.body);
  const client = await pool.connect();
  try {
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
    res.status(201).json(toAccountJson(account, 0));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

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
  res.json(toAccountJson(rows[0], Number(rows[0].balance_cents)));
});
