import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pool } from "../src/db/pool";
import { resetDb, createAccount, deposit, transfer, balanceOf } from "./helpers";

// Start every test with an empty ledger.
beforeEach(resetDb);

// Close the database connections so the test run can exit cleanly.
afterAll(async () => {
  await pool.end();
});

describe("concurrent transfers", () => {
  it("never lets simultaneous transfers overdraw an account", async () => {
    const alice = await createAccount("Alice");
    const bob = await createAccount("Bob");
    await deposit(alice, 7_000);

    // 5 transfers of $20 from a $70 balance, all sent at the same moment.
    // Row locking makes them run one at a time: 3 fit, 2 don't.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => transfer(alice, bob, 2_000)),
    );
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([201, 201, 201, 422, 422]);
    expect(await balanceOf(alice)).toBe(1_000);
    expect(await balanceOf(bob)).toBe(6_000);
  });
});

describe("idempotency", () => {
  it("replays a retried transfer instead of moving money twice", async () => {
    const alice = await createAccount("Alice");
    const bob = await createAccount("Bob");
    await deposit(alice, 10_000);

    const first = await transfer(alice, bob, 1_000, "retry-key");
    const retry = await transfer(alice, bob, 1_000, "retry-key");

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(retry.body.transactionId).toBe(first.body.transactionId);
    expect(await balanceOf(alice)).toBe(9_000);
  });

  it("rejects a reused key with a different amount", async () => {
    const alice = await createAccount("Alice");
    const bob = await createAccount("Bob");
    await deposit(alice, 10_000);

    await transfer(alice, bob, 1_000, "reused-key");
    const res = await transfer(alice, bob, 2_000, "reused-key");

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("idempotency_key_reused");
    expect(await balanceOf(alice)).toBe(9_000);
  });

  it("moves money once when the same request is sent 5 times at once", async () => {
    const alice = await createAccount("Alice");
    const bob = await createAccount("Bob");
    await deposit(alice, 10_000);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => transfer(alice, bob, 1_000, "parallel-key")),
    );

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    // Every response points to the same single transaction.
    expect(new Set(results.map((r) => r.body.transactionId)).size).toBe(1);
    expect(await balanceOf(alice)).toBe(9_000);
  });
});

describe("ledger integrity", () => {
  it("keeps all completed entries summing to zero", async () => {
    const alice = await createAccount("Alice");
    const bob = await createAccount("Bob");
    await deposit(alice, 10_000);
    await deposit(bob, 5_000);
    await transfer(alice, bob, 3_000);
    await transfer(bob, alice, 1_000);

    // Credits count as positive, debits as negative, completed transactions only.
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_cents ELSE -e.amount_cents END), 0) AS total
       FROM entries e
       JOIN transactions t ON t.id = e.transaction_id
       WHERE t.status = 'completed'`,
    );
    expect(Number(rows[0].total)).toBe(0);
  });
});
