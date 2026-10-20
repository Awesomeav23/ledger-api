import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { HttpError } from "../errors";

export const entriesRouter = Router();

// The :id in the URL must be a valid UUID.
const paramsSchema = z.object({ id: z.uuid() });

// Query string options. Values arrive as text (e.g. ?limit=5), so
// z.coerce converts limit to a number. Page size is 1–100, default 20.
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

// What a decoded cursor must contain: the last entry's timestamp and ID.
const cursorSchema = z.object({ ts: z.string(), id: z.uuid() });

// Turns the last entry's timestamp and ID into a URL-safe string that the
// client sends back to get the next page.
function encodeCursor(ts: string, id: string) {
  return Buffer.from(JSON.stringify({ ts, id })).toString("base64url");
}

// Reverses encodeCursor. Any broken or tampered cursor becomes a clean
// 400 error instead of crashing the request.
function decodeCursor(cursor: string) {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new HttpError(400, "invalid_cursor");
  }
}

// GET /accounts/:id/entries
// Returns an account's debits and credits, newest first, one page at a
// time. Uses cursor pagination: each page includes a nextCursor that
// points just past its last entry.
entriesRouter.get("/accounts/:id/entries", async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const { limit, cursor } = querySchema.parse(req.query);
  const after = cursor ? decodeCursor(cursor) : null;

  // Return 404 for unknown accounts, rather than an empty list.
  const { rows: accounts } = await pool.query("SELECT id FROM accounts WHERE id = $1", [id]);
  if (accounts.length === 0) throw new HttpError(404, "account_not_found");

  // - Sort by (created_at, id) newest first. The id breaks ties, since
  //   both entries of one transfer share the same timestamp.
  // - With a cursor, only return entries that come after it in that order.
  // - created_at::text keeps full microsecond precision for the cursor;
  //   a JavaScript Date only keeps milliseconds, which could skip entries.
  // - Fetch limit + 1 rows: if the extra row exists, there's another page.
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

  // Drop the extra row, and build the next cursor from the page's last entry.
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
    // null means this is the last page.
    nextCursor: hasMore ? encodeCursor(last.cursor_ts, last.id) : null,
  });
});
