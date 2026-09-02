import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.issues });
    return;
  }

  // Never echo raw error details back to the client — log them server-side only.
  console.error(`[error] ${req.method} ${req.path} requestId=${req.requestId}`, err);
  res.status(500).json({ error: "Internal server error", requestId: req.requestId });
};
