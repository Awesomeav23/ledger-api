import { PoolClient } from "pg";

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
  return Number(rows[0].balance_cents);
}
