import { Pool } from "pg";

// Stop at startup with a clear message if the database URL is missing,
// instead of failing later with a confusing connection error.
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// A pool keeps a set of open database connections and reuses them,
// instead of opening a new connection for every request.
// Routes call pool.query() for single queries, or pool.connect() to get
// one client for a multi-step transaction (BEGIN ... COMMIT).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
