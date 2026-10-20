import express from "express";
import { healthRouter } from "./routes/health";
import { accountsRouter } from "./routes/accounts";
import { depositsRouter } from "./routes/deposits";
import { transfersRouter } from "./routes/transfers";
import { entriesRouter } from "./routes/entries";
import { errorHandler } from "./errors";

// The Express app. It's exported separately from server.ts so tests can
// send requests to it without starting a real server.
export const app = express();

// Parse JSON request bodies so routes can read them from req.body.
app.use(express.json());

// Routes, one router per feature.
app.use(healthRouter); // GET /health
app.use(accountsRouter); // POST /accounts, GET /accounts/:id
app.use(depositsRouter); // POST /deposits
app.use(transfersRouter); // POST /transfers
app.use(entriesRouter); // GET /accounts/:id/entries

// Error handler. It must be registered last, so it catches errors
// thrown by any route above it.
app.use(errorHandler);
