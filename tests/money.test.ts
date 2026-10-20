import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db/pool";
import { SYSTEM_CASH_ACCOUNT_ID } from "../src/constants";
import { resetDb, createAccount, deposit, transfer, balanceOf } from "./helpers";

// Start every test with an empty ledger.
beforeEach(resetDb);

// Close the database connections so the test run can exit cleanly.
afterAll(async () => {
  await pool.end();
});

describe("POST /deposits", () => {
  it("credits the account and debits system cash by the same amount", async () => {
    const alice = await createAccount("Alice");
    const res = await deposit(alice, 10_000);

    expect(res.status).toBe(201);
    expect(res.body.balanceCents).toBe(10_000);
    expect(await balanceOf(alice)).toBe(10_000);
    expect(await balanceOf(SYSTEM_CASH_ACCOUNT_ID)).toBe(-10_000);
  });

  it("rejects an amount that isn't a whole number of cents", async () => {
    const alice = await createAccount("Alice");
    const res = await deposit(alice, 12.5);
    expect(res.status).toBe(400);
  });

  it("rejects a deposit into the system cash account", async () => {
    const res = await deposit(SYSTEM_CASH_ACCOUNT_ID, 500);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("cannot_deposit_to_system_account");
  });

  it("returns 404 for an account that doesn't exist", async () => {
    const res = await deposit("00000000-0000-4000-8000-000000000000", 500);
    expect(res.status).toBe(404);
  });
});

describe("POST /transfers", () => {
  it("moves money from one account to another", async () => {
    const alice = await createAccount("Alice");
    const bob = await createAccount("Bob");
    await deposit(alice, 10_000);

    const res = await transfer(alice, bob, 3_000);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "completed",
      flags: [],
      fromBalanceCents: 7_000,
      toBalanceCents: 3_000,
    });
    expect(await balanceOf(alice)).toBe(7_000);
    expect(await balanceOf(bob)).toBe(3_000);
  });

  it("rejects a transfer larger than the sender's balance", async () => {
    const alice = await createAccount("Alice");
    const bob = await createAccount("Bob");
    await deposit(alice, 10_000);

    const res = await transfer(alice, bob, 20_000);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("insufficient_funds");
    expect(await balanceOf(alice)).toBe(10_000);
  });

  it("rejects a transfer from an account to itself", async () => {
    const alice = await createAccount("Alice");
    const res = await transfer(alice, alice, 1_000);
    expect(res.status).toBe(400);
  });

  it("rejects a transfer out of the system cash account", async () => {
    const bob = await createAccount("Bob");
    const res = await transfer(SYSTEM_CASH_ACCOUNT_ID, bob, 1_000);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("cannot_transfer_with_system_account");
  });

  it("requires an Idempotency-Key header", async () => {
    const alice = await createAccount("Alice");
    const bob = await createAccount("Bob");
    const res = await request(app)
      .post("/transfers")
      .send({ fromAccountId: alice, toAccountId: bob, amountCents: 1_000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("idempotency_key_required");
  });
});
