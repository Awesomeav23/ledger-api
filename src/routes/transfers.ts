import { Router, Response } from "express";
import { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/pool";
import { getBalanceCents } from "../db/balance";
import { HttpError } from "../errors";
import { getIdempotencyKey, hashRequest } from "../idempotency";

export const transfersRouter = Router();

// Request body rules: both IDs must be UUIDs, the amount must be a
// positive whole number of cents (max $1,000,000), and the two
// accounts must be different.
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

// NEW: Postgres error code for "duplicate key value violates unique constraint".
const UNIQUE_VIOLATION = "23505";

// NEW: True if the error came from a unique constraint (e.g. a duplicate idempotency key).
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

type StoredTransaction = { request_hash: string | null; response_body: unknown };

// NEW: Looks up an earlier transaction that used this idempotency key.
async function findByKey(client: PoolClient, key: string): Promise<StoredTransaction | undefined> {
  const { rows } = await client.query(
    "SELECT request_hash, response_body FROM transactions WHERE idempotency_key = $1",
    [key],
  );
  return rows[0];
}

// NEW: Sends back the original response for a retried request.
// If the key was reused with a different body, rejects it instead.
function replay(res: Response, stored: StoredTransaction, requestHash: string) {
  if (stored.request_hash !== requestHash) {
    throw new HttpError(422, "idempotency_key_reused");
  }
  res.setHeader("Idempotent-Replayed", "true");
  res.status(201).json(stored.response_body);
}

transfersRouter.post("/transfers", async (req, res) => {
  // NEW: Read the key and fingerprint the request before doing any work.
  const idempotencyKey = getIdempotencyKey(req);
  const body = transferSchema.parse(req.body);
  const requestHash = hashRequest(body);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock both accounts until COMMIT so no other transfer can change them
    // at the same time. ORDER BY id locks them in a fixed order, which
    // prevents two opposite transfers from deadlocking.
    const { rows: accounts } = await client.query(
      `SELECT id, currency, is_system FROM accounts
       WHERE id = ANY($1::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [[body.fromAccountId, body.toAccountId]],
    );

    // NEW: Check for an earlier transfer with this key. This runs after the
    // lock, so a duplicate request that was waiting on the lock will see the
    // first request's committed transaction here and replay it.
    const stored = await findByKey(client, idempotencyKey);
    if (stored) {
      await client.query("ROLLBACK");
      replay(res, stored, requestHash);
      return;
    }

    // Both accounts must exist, neither can be the system account,
    // and they must use the same currency.
    const from = accounts.find((a) => a.id === body.fromAccountId);
    const to = accounts.find((a) => a.id === body.toAccountId);
    if (!from || !to) throw new HttpError(404, "account_not_found");
    if (from.is_system || to.is_system) {
      throw new HttpError(400, "cannot_transfer_with_system_account");
    }
    if (from.currency !== to.currency) throw new HttpError(400, "currency_mismatch");

    // The sender must have enough money. This is checked while the
    // account is locked, so the balance can't change mid-check.
    const fromBalance = await getBalanceCents(client, body.fromAccountId);
    if (fromBalance < body.amountCents) throw new HttpError(422, "insufficient_funds");

    // Create the transaction, now saving the client's key and the request fingerprint.
    const { rows: txRows } = await client.query(
      `INSERT INTO transactions (idempotency_key, status, request_hash)
       VALUES ($1, 'completed', $2) RETURNING id`,
      [idempotencyKey, requestHash],
    );
    const transactionId = txRows[0].id;

    // Double-entry: debit the sender and credit the receiver by the same amount.
    await client.query(
      `INSERT INTO entries (transaction_id, account_id, amount_cents, direction)
       VALUES ($1, $2, $4, 'debit'), ($1, $3, $4, 'credit')`,
      [transactionId, body.fromAccountId, body.toAccountId, body.amountCents],
    );

    // Record the transfer in the audit log.
    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, payload)
       VALUES ('transfer.created', 'transaction', $1, $2)`,
      [transactionId, JSON.stringify({ ...body, idempotencyKey })],
    );

    // Build the response with both new balances.
    const responseBody = {
      transactionId,
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      amountCents: body.amountCents,
      status: "completed",
      fromBalanceCents: await getBalanceCents(client, body.fromAccountId),
      toBalanceCents: await getBalanceCents(client, body.toAccountId),
    };

    // NEW: Save the response so a retry can get back exactly the same thing.
    await client.query("UPDATE transactions SET response_body = $1 WHERE id = $2", [
      JSON.stringify(responseBody),
      transactionId,
    ]);

    await client.query("COMMIT");
    res.status(201).json(responseBody);
  } catch (err) {
    // Undo everything from this request if any step failed.
    await client.query("ROLLBACK");

    // NEW: If another request with the same key committed first (for example,
    // a retry involving different accounts that didn't wait on our lock),
    // the insert fails with a unique violation. Replay that request's result.
    if (isUniqueViolation(err)) {
      const winner = await findByKey(client, idempotencyKey);
      if (winner) {
        replay(res, winner, requestHash);
        return;
      }
    }
    throw err;
  } finally {
    // Always return the database connection to the pool.
    client.release();
  }
});
