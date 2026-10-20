import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool";
import { getBalanceCents } from "../db/balance";
import { SYSTEM_CASH_ACCOUNT_ID } from "../constants";
import { HttpError } from "../errors";

export const depositsRouter = Router();

// Request body: the account must be a UUID, and the amount must be a
// positive whole number of cents, up to $1,000,000.
const depositSchema = z.object({
  accountId: z.uuid(),
  amountCents: z.number().int().positive().max(100_000_000),
});

// POST /deposits
// Adds money to an account. In double-entry, money can't appear from
// nothing, so every deposit debits the system cash account and credits
// the user's account by the same amount.
depositsRouter.post("/deposits", async (req, res) => {
  const body = depositSchema.parse(req.body);
  const client = await pool.connect();
  try {
    // Everything below is one transaction: all saved, or none.
    await client.query("BEGIN");

    // The account must exist, can't be the system account, and must use
    // USD (the currency of the system cash account).
    const { rows: accounts } = await client.query(
      "SELECT id, currency, is_system FROM accounts WHERE id = $1",
      [body.accountId],
    );
    if (accounts.length === 0) throw new HttpError(404, "account_not_found");
    if (accounts[0].is_system) throw new HttpError(400, "cannot_deposit_to_system_account");
    if (accounts[0].currency !== "USD") throw new HttpError(400, "currency_mismatch");

    // Create the transaction. Deposits don't take an Idempotency-Key header
    // yet, so a random key fills the required column.
    const { rows: txRows } = await client.query(
      "INSERT INTO transactions (idempotency_key, status) VALUES ($1, 'completed') RETURNING id",
      [randomUUID()],
    );
    const transactionId = txRows[0].id;

    // Double-entry: debit system cash, credit the user's account.
    await client.query(
      `INSERT INTO entries (transaction_id, account_id, amount_cents, direction)
       VALUES ($1, $2, $4, 'debit'), ($1, $3, $4, 'credit')`,
      [transactionId, SYSTEM_CASH_ACCOUNT_ID, body.accountId, body.amountCents],
    );

    // Record the deposit in the audit log.
    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, payload)
       VALUES ('deposit.created', 'transaction', $1, $2)`,
      [transactionId, JSON.stringify({ accountId: body.accountId, amountCents: body.amountCents })],
    );

    // Read the new balance inside the same transaction, before committing.
    const balanceCents = await getBalanceCents(client, body.accountId);
    await client.query("COMMIT");

    res.status(201).json({
      transactionId,
      accountId: body.accountId,
      amountCents: body.amountCents,
      status: "completed",
      balanceCents,
    });
  } catch (err) {
    // Undo everything from this request if any step failed.
    await client.query("ROLLBACK");
    throw err;
  } finally {
    // Always return the connection to the pool.
    client.release();
  }
});
