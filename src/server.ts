// Loads variables from .env (PORT, DATABASE_URL) into process.env.
// This must be the first import, because pool.ts reads DATABASE_URL
// as soon as it loads.
import "dotenv/config";
import { app } from "./app";

// Use the PORT from .env, or 3000 if it isn't set.
const port = Number(process.env.PORT) || 3000;

// Start the HTTP server. This file only starts the server; the routes
// live in app.ts, so tests can import the app without starting a server.
app.listen(port, () => {
  console.log(`Ledger API running on http://localhost:${port}`);
});
