import { Router } from "express";
import { pool } from "../db/pool";

export const healthRouter = Router();

// GET /health
// Reports whether the API is running and can reach the database.
// Hosting platforms can call this to check if the app is healthy.
healthRouter.get("/health", async (_req, res) => {
  try {
    // The simplest possible query, just to confirm the database responds.
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    // Log the real reason (e.g. ECONNREFUSED) in the server terminal,
    // and return 503 so callers know the service is unavailable.
    console.error("Health check failed:", err);
    res.status(503).json({ status: "error", db: "unreachable" });
  }
});
