import { PoolClient } from "pg";

// Calculates an account's balance in cents from its ledger entries:
// credits add, debits subtract. Only completed transactions count, so
// pending or rejected transfers don't affect the balance.
//
// It takes a client (not the pool) so it can run inside an open
// transaction, e.g. while a transfer has the account locked.
export async function getBalanceCents(client: PoolClient, accountId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(
       CASE WHEN e.direction = 'credit' THEN e.amount_cents ELSE -e.amount_cents END
     ), 0) AS balance_cents
     FROM entries e
     JOIN transactions t ON t.id = e.transaction_id
     WHERE e.account_id = $1 AND t.status = 'completed'`,
    [accountId],
  );
  // COALESCE returns 0 when there are no entries yet. Postgres returns
  // sums of BIGINT values as strings, so convert to a number.
  return Number(rows[0].balance_cents);
}
