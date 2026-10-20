import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

// An error with an HTTP status code attached. Routes throw these for
// known problems, e.g. throw new HttpError(404, "account_not_found").
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Central error handler: every error thrown in a route ends up here
// (Express 5 forwards errors from async routes automatically).
// The underscore names mark parameters Express requires but this
// function doesn't use.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Invalid input caught by a Zod schema: 400, with which field failed and why.
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "validation_error",
      details: err.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    });
    return;
  }

  // A known problem thrown by a route: use its own status and message.
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Anything unexpected: log the details for debugging, but send the
  // client a generic 500 so internal details aren't exposed.
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
}
