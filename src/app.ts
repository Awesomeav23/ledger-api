import express from "express";
import { healthRouter } from "./routes/health";
import { accountsRouter } from "./routes/accounts";
import { errorHandler } from "./errors";

export const app = express();

app.use(express.json());
app.use(healthRouter);
app.use(accountsRouter);
app.use(errorHandler);
