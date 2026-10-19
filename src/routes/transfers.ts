import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool";
import { getBalanceCents } from "../db/balance";
import { HttpError } from "../errors";

export const transfersRouter = Router();

const transferSchema = z
  .object({
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    amountCents: z.number().int().positive().max(100_000_000),
  })
  .refine((b) => b.fromAccountId !== b.toAccountId, {
    message: "fromAccountId and toAccountId must be different",
    path: ["toAccountId"],
  });

transfersRouter.post("/transfers", async (req, res) => {
  const body = transferSchema.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: accounts } = await client.query(
      `SELECT id, currency, is_system FROM accounts
       WHERE id = ANY($1::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [[body.fromAccountId, body.toAccountId]],
    );
    const from = accounts.find((a) => a.id === body.fromAccountId);
    const to = accounts.find((a) => a.id === body.toAccountId);
    if (!from || !to) throw new HttpError(404, "account_not_found");
    if (from.is_system || to.is_system) {
      throw new HttpError(400, "cannot_transfer_with_system_account");
    }
    if (from.currency !== to.currency) throw new HttpError(400, "currency_mismatch");

    const fromBalance = await getBalanceCents(client, body.fromAccountId);
    if (fromBalance < body.amountCents) throw new HttpError(422, "insufficient_funds");

    const { rows: txRows } = await client.query(
      "INSERT INTO transactions (idempotency_key, status) VALUES ($1, 'completed') RETURNING id",
      [randomUUID()],
    );
    const transactionId = txRows[0].id;

    await client.query(
      `INSERT INTO entries (transaction_id, account_id, amount_cents, direction)
       VALUES ($1, $2, $4, 'debit'), ($1, $3, $4, 'credit')`,
      [transactionId, body.fromAccountId, body.toAccountId, body.amountCents],
    );

    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, payload)
       VALUES ('transfer.created', 'transaction', $1, $2)`,
      [transactionId, JSON.stringify(body)],
    );

    const fromBalanceCents = await getBalanceCents(client, body.fromAccountId);
    const toBalanceCents = await getBalanceCents(client, body.toAccountId);
    await client.query("COMMIT");

    res.status(201).json({
      transactionId,
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      amountCents: body.amountCents,
      status: "completed",
      fromBalanceCents,
      toBalanceCents,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
