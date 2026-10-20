import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db/pool";
import { resetDb, createAccount, deposit, transfer, balanceOf } from "./helpers";

// Start every test with an empty ledger.
beforeEach(resetDb);

// Close the database connections so the test run can exit cleanly.
afterAll(async () => {
  await pool.end();
});

// Finds the flag ID for a held transfer.
async function flagIdFor(transactionId: string): Promise<string> {
  const { rows } = await pool.query("SELECT id FROM fraud_flags WHERE transaction_id = $1", [
    transactionId,
  ]);
  return rows[0].id;
}

// Sets up Alice with $100 and a held $95 transfer to Bob (flagged for
// draining over 90% of her balance).
async function heldTransfer() {
  const alice = await createAccount("Alice");
  const bob = await createAccount("Bob");
  await deposit(alice, 10_000);
  const res = await transfer(alice, bob, 9_500);
  const flagId = await flagIdFor(res.body.transactionId);
  return { alice, bob, res, flagId };
}

describe("flagged transfers", () => {
  it("holds a flagged transfer without changing balances", async () => {
    const { alice, bob, res } = await heldTransfer();

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending_review");
    expect(res.body.flags.map((f: { rule: string }) => f.rule)).toEqual(["drains_balance"]);
    expect(await balanceOf(alice)).toBe(10_000);
    expect(await balanceOf(bob)).toBe(0);
  });

  it("lists the flag as open", async () => {
    const { flagId } = await heldTransfer();
    const res = await request(app).get("/flags");
    expect(res.body.flags.map((f: { id: string }) => f.id)).toEqual([flagId]);
  });
});

describe("POST /flags/:id/approve", () => {
  it("completes the transfer and moves the money", async () => {
    const { alice, bob, flagId } = await heldTransfer();

    const res = await request(app).post(`/flags/${flagId}/approve`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(await balanceOf(alice)).toBe(500);
    expect(await balanceOf(bob)).toBe(9_500);

    // The flag is no longer open.
    const open = await request(app).get("/flags");
    expect(open.body.flags).toEqual([]);
  });

  it("refuses to approve the same flag twice", async () => {
    const { alice, flagId } = await heldTransfer();
    await request(app).post(`/flags/${flagId}/approve`);

    const res = await request(app).post(`/flags/${flagId}/approve`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_reviewed");
    expect(await balanceOf(alice)).toBe(500);
  });

  it("re-checks the balance and refuses if the money was spent meanwhile", async () => {
    const { alice, bob, flagId } = await heldTransfer();

    // While the $95 transfer waits, Alice spends $30 on a normal transfer.
    const spend = await transfer(alice, bob, 3_000);
    expect(spend.status).toBe(201);

    // Approving now would overdraw her ($70 left), so it must be refused.
    const res = await request(app).post(`/flags/${flagId}/approve`);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("insufficient_funds");
    expect(await balanceOf(alice)).toBe(7_000);
  });
});

describe("POST /flags/:id/reject", () => {
  it("rejects the transfer so its money never moves", async () => {
    const { alice, bob, res: held, flagId } = await heldTransfer();

    const res = await request(app).post(`/flags/${flagId}/reject`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(await balanceOf(alice)).toBe(10_000);
    expect(await balanceOf(bob)).toBe(0);

    const { rows } = await pool.query("SELECT status FROM transactions WHERE id = $1", [
      held.body.transactionId,
    ]);
    expect(rows[0].status).toBe("rejected");
  });

  it("returns 404 for a flag that doesn't exist", async () => {
    const res = await request(app).post("/flags/00000000-0000-4000-8000-000000000000/reject");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("flag_not_found");
  });
});
