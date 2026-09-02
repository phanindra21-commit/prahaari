import rateLimit from "express-rate-limit";
import type { Request } from "express";

function loginKeyGenerator(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === "string" ? body.email.toLowerCase() : "unknown-email";
  return `${req.ip ?? "unknown-ip"}:${email}`;
}

/** 5 attempts per 15 minutes, keyed by IP+email so one bad actor can't lock out a whole office's shared IP. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: loginKeyGenerator,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
});

export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many refresh attempts. Try again later." },
});
