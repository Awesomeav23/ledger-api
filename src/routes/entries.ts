import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { HttpError } from "../errors";

export const entriesRouter = Router();

const paramsSchema = z.object({ id: z.uuid() });
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
const cursorSchema = z.object({ ts: z.string(), id: z.uuid() });

function encodeCursor(ts: string, id: string) {
  return Buffer.from(JSON.stringify({ ts, id })).toString("base64url");
}

function decodeCursor(cursor: string) {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new HttpError(400, "invalid_cursor");
  }
}

entriesRouter.get("/accounts/:id/entries", async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const { limit, cursor } = querySchema.parse(req.query);
  const after = cursor ? decodeCursor(cursor) : null;

  const { rows: accounts } = await pool.query("SELECT id FROM accounts WHERE id = $1", [id]);
  if (accounts.length === 0) throw new HttpError(404, "account_not_found");

  const { rows } = await pool.query(
    `SELECT e.id, e.transaction_id, e.amount_cents, e.direction, e.created_at,
            e.created_at::text AS cursor_ts, t.status
     FROM entries e
     JOIN transactions t ON t.id = e.transaction_id
     WHERE e.account_id = $1
       AND ($2::timestamptz IS NULL OR (e.created_at, e.id) < ($2::timestamptz, $3::uuid))
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $4`,
    [id, after?.ts ?? null, after?.id ?? null, limit + 1],
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  res.json({
    entries: page.map((r) => ({
      id: r.id,
      transactionId: r.transaction_id,
      amountCents: Number(r.amount_cents),
      direction: r.direction,
      status: r.status,
      createdAt: r.created_at,
    })),
    nextCursor: hasMore ? encodeCursor(last.cursor_ts, last.id) : null,
  });
});
