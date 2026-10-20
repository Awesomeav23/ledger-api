import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db/pool";

describe("GET /health", () => {
  it("reports ok when the database is reachable", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "connected" });
  });
});

// Close the database connections so the test run can exit cleanly.
afterAll(async () => {
  await pool.end();
});
