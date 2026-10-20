import express from "express";
import { healthRouter } from "./routes/health";
import { accountsRouter } from "./routes/accounts";
import { depositsRouter } from "./routes/deposits";
import { transfersRouter } from "./routes/transfers";
import { entriesRouter } from "./routes/entries";
import { errorHandler } from "./errors";

export const app = express();

app.use(express.json());
app.use(healthRouter);
app.use(accountsRouter);
app.use(depositsRouter);
app.use(transfersRouter);
app.use(entriesRouter);
app.use(errorHandler);
