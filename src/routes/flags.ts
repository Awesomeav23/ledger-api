import { Router } from "express";
import { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/pool";
import { getBalanceCents } from "../db/balance";
import { HttpError } from "../errors";

export const flagsRouter = Router();

// The :id in the URL must be a valid UUID.
const idParamSchema = z.object({ id: z.uuid() });

// GET /flags?status=... filter. Defaults to open flags.
const listQuerySchema = z.object({
  status: z.enum(["open", "approved", "rejected"]).default("open"),
});

// Details of a flagged transfer, gathered for approve and reject.
type PendingTransfer = {
  transactionId: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
};

// Finds the transfer behind a flag and locks its transaction row, so two
// reviewers can't approve or reject the same transfer at the same time.
// Fails if the flag doesn't exist or the transfer was already reviewed.
async function loadPendingTransfer(client: PoolClient, flagId: string): Promise<PendingTransfer> {
  const { rows: flagRows } = await client.query(
    "SELECT transaction_id FROM fraud_flags WHERE id = $1",
    [flagId],
  );
  if (flagRows.length === 0) throw new HttpError(404, "flag_not_found");
  const transactionId = flagRows[0].transaction_id;

  // FOR UPDATE: a second reviewer waits here, then sees the new status.
  const { rows: txRows } = await client.query(
    "SELECT status FROM transactions WHERE id = $1 FOR UPDATE",
    [transactionId],
  );
  if (txRows[0].status !== "pending_review") throw new HttpError(409, "already_reviewed");

  // The debit entry is the sender, the credit entry is the receiver.
  const { rows: entryRows } = await client.query(
    "SELECT account_id, amount_cents, direction FROM entries WHERE transaction_id = $1",
    [transactionId],
  );
  const debit = entryRows.find((e) => e.direction === "debit");
  const credit = entryRows.find((e) => e.direction === "credit");

  return {
    transactionId,
    fromAccountId: debit.account_id,
    toAccountId: credit.account_id,
    amountCents: Number(debit.amount_cents),
  };
}

// GET /flags
// Lists flags with the transfer each one belongs to, newest first.
flagsRouter.get("/flags", async (req, res) => {
  const { status } = listQuerySchema.parse(req.query);
  const { rows } = await pool.query(
    `SELECT f.id, f.transaction_id, f.rule, f.reason, f.status, f.created_at, f.reviewed_at,
            d.account_id AS from_account_id, c.account_id AS to_account_id, d.amount_cents
     FROM fraud_flags f
     JOIN entries d ON d.transaction_id = f.transaction_id AND d.direction = 'debit'
     JOIN entries c ON c.transaction_id = f.transaction_id AND c.direction = 'credit'
     WHERE f.status = $1
     ORDER BY f.created_at DESC
     LIMIT 100`,
    [status],
  );
  res.json({
    flags: rows.map((r) => ({
      id: r.id,
      transactionId: r.transaction_id,
      rule: r.rule,
      reason: r.reason,
      status: r.status,
      fromAccountId: r.from_account_id,
      toAccountId: r.to_account_id,
      amountCents: Number(r.amount_cents),
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
    })),
  });
});

// POST /flags/:id/approve
// Completes a held transfer, so its money moves.
flagsRouter.post("/flags/:id/approve", async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transfer = await loadPendingTransfer(client, id);

    // Lock both accounts in ID order, same as the transfers route.
    await client.query("SELECT id FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [
      [transfer.fromAccountId, transfer.toAccountId],
    ]);

    // Check the balance again: the sender may have spent money while this
    // transfer was waiting. If there isn't enough now, it stays pending.
    const fromBalance = await getBalanceCents(client, transfer.fromAccountId);
    if (fromBalance < transfer.amountCents) throw new HttpError(422, "insufficient_funds");

    // Mark the transfer completed and close all of its flags.
    await client.query("UPDATE transactions SET status = 'completed' WHERE id = $1", [
      transfer.transactionId,
    ]);
    await client.query(
      "UPDATE fraud_flags SET status = 'approved', reviewed_at = now() WHERE transaction_id = $1",
      [transfer.transactionId],
    );
    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, payload)
       VALUES ('transfer.approved', 'transaction', $1, $2)`,
      [transfer.transactionId, JSON.stringify({ flagId: id })],
    );

    // Read the new balances before committing.
    const fromBalanceCents = await getBalanceCents(client, transfer.fromAccountId);
    const toBalanceCents = await getBalanceCents(client, transfer.toAccountId);
    await client.query("COMMIT");

    res.json({ ...transfer, status: "completed", fromBalanceCents, toBalanceCents });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// POST /flags/:id/reject
// Rejects a held transfer. Its entries stay in the ledger for the record,
// but a rejected transaction never counts toward any balance.
flagsRouter.post("/flags/:id/reject", async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transfer = await loadPendingTransfer(client, id);

    await client.query("UPDATE transactions SET status = 'rejected' WHERE id = $1", [
      transfer.transactionId,
    ]);
    await client.query(
      "UPDATE fraud_flags SET status = 'rejected', reviewed_at = now() WHERE transaction_id = $1",
      [transfer.transactionId],
    );
    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, payload)
       VALUES ('transfer.rejected', 'transaction', $1, $2)`,
      [transfer.transactionId, JSON.stringify({ flagId: id })],
    );
    await client.query("COMMIT");

    res.json({ ...transfer, status: "rejected" });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
