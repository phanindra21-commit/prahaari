import type { RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";

/** Every request gets a fresh server-generated id, echoed back and threaded through every log line and audit entry. */
export const requestId: RequestHandler = (req, res, next) => {
  const id = uuidv4();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};
