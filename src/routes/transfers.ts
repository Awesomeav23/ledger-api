import { Router, Response } from "express";
import { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/pool";
import { getBalanceCents } from "../db/balance";
import { HttpError } from "../errors";
import { getIdempotencyKey, hashRequest } from "../idempotency";
import { evaluateRules } from "../fraud/rules";

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

// Postgres error code for "duplicate key value violates unique constraint".
const UNIQUE_VIOLATION = "23505";

// True if the error came from a unique constraint (e.g. a duplicate idempotency key).
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

type StoredTransaction = { request_hash: string | null; response_body: { status?: string } | null };

// Looks up an earlier transaction that used this idempotency key.
async function findByKey(client: PoolClient, key: string): Promise<StoredTransaction | undefined> {
  const { rows } = await client.query(
    "SELECT request_hash, response_body FROM transactions WHERE idempotency_key = $1",
    [key],
  );
  return rows[0];
}

// Sends back the original response for a retried request.
// If the key was reused with a different body, rejects it instead.
function replay(res: Response, stored: StoredTransaction, requestHash: string) {
  if (stored.request_hash !== requestHash) {
    throw new HttpError(422, "idempotency_key_reused");
  }
  res.setHeader("Idempotent-Replayed", "true");
  // NEW (Phase 4): a flagged transfer was originally answered with 202,
  // so its replay uses 202 too.
  const statusCode = stored.response_body?.status === "pending_review" ? 202 : 201;
  res.status(statusCode).json(stored.response_body);
}

// NEW (Phase 4): Counts transfers sent from this account in the last minute
// (completed or waiting for review), for the high-velocity rule.
// A transfer out of an account always writes a debit entry for it.
async function countRecentTransfers(client: PoolClient, accountId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT e.transaction_id) AS count
     FROM entries e
     JOIN transactions t ON t.id = e.transaction_id
     WHERE e.account_id = $1
       AND e.direction = 'debit'
       AND t.status IN ('completed', 'pending_review')
       AND t.created_at > now() - interval '1 minute'`,
    [accountId],
  );
  return Number(rows[0].count);
}

transfersRouter.post("/transfers", async (req, res) => {
  // Read the key and fingerprint the request before doing any work.
  const idempotencyKey = getIdempotencyKey(req);
  const body = transferSchema.parse(req.body);
  const requestHash = hashRequest(body);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock both accounts until COMMIT so no other transfer can change them
    // at the same time. ORDER BY id locks them in a fixed order, which
    // prevents two opposite transfers from deadlocking.
    // NEW (Phase 4): created_at is also read, for the new-account rule.
    const { rows: accounts } = await client.query(
      `SELECT id, currency, is_system, created_at FROM accounts
       WHERE id = ANY($1::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [[body.fromAccountId, body.toAccountId]],
    );

    // Check for an earlier transfer with this key. This runs after the
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

    // NEW (Phase 4): Run the fraud rules. Any flag holds the transfer for review.
    const flags = evaluateRules({
      amountCents: body.amountCents,
      fromBalanceCents: fromBalance,
      fromAccountCreatedAt: from.created_at,
      recentTransferCount: await countRecentTransfers(client, body.fromAccountId),
      now: new Date(),
    });
    const status = flags.length > 0 ? "pending_review" : "completed";

    // Create the transaction with the client's key, the request fingerprint,
    // and (NEW) either 'completed' or 'pending_review'.
    const { rows: txRows } = await client.query(
      `INSERT INTO transactions (idempotency_key, status, request_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [idempotencyKey, status, requestHash],
    );
    const transactionId = txRows[0].id;

    // Double-entry: debit the sender and credit the receiver by the same amount.
    // For a pending transfer these entries are written now, but balances only
    // count completed transactions, so nothing moves until it's approved.
    await client.query(
      `INSERT INTO entries (transaction_id, account_id, amount_cents, direction)
       VALUES ($1, $2, $4, 'debit'), ($1, $3, $4, 'credit')`,
      [transactionId, body.fromAccountId, body.toAccountId, body.amountCents],
    );

    // NEW (Phase 4): Save one row per rule that flagged the transfer.
    for (const flag of flags) {
      await client.query(
        "INSERT INTO fraud_flags (transaction_id, rule, reason) VALUES ($1, $2, $3)",
        [transactionId, flag.rule, flag.reason],
      );
    }

    // Record the transfer in the audit log, including any flags.
    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, payload)
       VALUES ($1, 'transaction', $2, $3)`,
      [
        flags.length > 0 ? "transfer.flagged" : "transfer.created",
        transactionId,
        JSON.stringify({ ...body, idempotencyKey, flags }),
      ],
    );

    // Build the response with both balances and (NEW) any flags.
    const responseBody = {
      transactionId,
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      amountCents: body.amountCents,
      status,
      flags,
      fromBalanceCents: await getBalanceCents(client, body.fromAccountId),
      toBalanceCents: await getBalanceCents(client, body.toAccountId),
    };

    // Save the response so a retry can get back exactly the same thing.
    await client.query("UPDATE transactions SET response_body = $1 WHERE id = $2", [
      JSON.stringify(responseBody),
      transactionId,
    ]);

    await client.query("COMMIT");
    // NEW (Phase 4): 202 Accepted means "received, but not completed yet".
    res.status(status === "pending_review" ? 202 : 201).json(responseBody);
  } catch (err) {
    // Undo everything from this request if any step failed.
    await client.query("ROLLBACK");

    // If another request with the same key committed first (for example,
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
