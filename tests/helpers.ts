import request from "supertest";
import { randomUUID } from "crypto";
import { app } from "../src/app";
import { pool } from "../src/db/pool";

// Clears all test data so each test starts from an empty ledger.
// The system cash account is kept, since migration 005 created it and
// deposits depend on it.
export async function resetDb() {
  await pool.query("TRUNCATE fraud_flags, entries, audit_log, transactions");
  await pool.query("DELETE FROM accounts WHERE is_system = false");
}

// Creates an account through the API and returns its ID.
export async function createAccount(ownerName = "Test User"): Promise<string> {
  const res = await request(app).post("/accounts").send({ ownerName });
  return res.body.id;
}

// Deposits money into an account through the API.
export async function deposit(accountId: string, amountCents: number) {
  return request(app).post("/deposits").send({ accountId, amountCents });
}

// Sends a transfer with a fresh idempotency key, unless a key is given.
export function transfer(
  fromAccountId: string,
  toAccountId: string,
  amountCents: number,
  key: string = randomUUID(),
) {
  return request(app)
    .post("/transfers")
    .set("Idempotency-Key", key)
    .send({ fromAccountId, toAccountId, amountCents });
}

// Reads an account's current balance through the API.
export async function balanceOf(accountId: string): Promise<number> {
  const res = await request(app).get(`/accounts/${accountId}`);
  return res.body.balanceCents;
}
