import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db/pool";
import { resetDb } from "./helpers";

// Start every test with an empty ledger.
beforeEach(resetDb);

// Close the database connections so the test run can exit cleanly.
afterAll(async () => {
  await pool.end();
});

describe("POST /accounts", () => {
  it("creates an account with a zero balance and USD by default", async () => {
    const res = await request(app).post("/accounts").send({ ownerName: "Alice" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ownerName: "Alice", currency: "USD", balanceCents: 0 });
    expect(res.body.id).toBeDefined();
  });

  it("records the new account in the audit log", async () => {
    const res = await request(app).post("/accounts").send({ ownerName: "Alice" });
    const { rows } = await pool.query("SELECT action FROM audit_log WHERE entity_id = $1", [
      res.body.id,
    ]);
    expect(rows).toEqual([{ action: "account.created" }]);
  });

  it("rejects an empty name", async () => {
    const res = await request(app).post("/accounts").send({ ownerName: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("rejects a lowercase currency", async () => {
    const res = await request(app).post("/accounts").send({ ownerName: "Bad", currency: "usd" });
    expect(res.status).toBe(400);
  });
});

describe("GET /accounts/:id", () => {
  it("returns an existing account", async () => {
    const created = await request(app).post("/accounts").send({ ownerName: "Bob" });
    const res = await request(app).get(`/accounts/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, ownerName: "Bob", balanceCents: 0 });
  });

  it("rejects an ID that isn't a UUID", async () => {
    const res = await request(app).get("/accounts/abc");
    expect(res.status).toBe(400);
  });

  it("returns 404 for an account that doesn't exist", async () => {
    const res = await request(app).get("/accounts/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("account_not_found");
  });
});

describe("GET /accounts", () => {
  it("lists customer accounts newest first, without the system account", async () => {
    const first = await request(app).post("/accounts").send({ ownerName: "First" });
    const second = await request(app).post("/accounts").send({ ownerName: "Second" });

    const res = await request(app).get("/accounts");

    expect(res.status).toBe(200);
    expect(res.body.accounts.map((a: { id: string }) => a.id)).toEqual([
      second.body.id,
      first.body.id,
    ]);
  });
});
