import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import type { HealthCheckResponse } from "@prahari/shared";
import { corsAllowedOrigins } from "./lib/env";
import { requestId } from "./middleware/requestId";
import { autoAudit } from "./middleware/autoAudit";
import { errorHandler } from "./middleware/errorHandler";
import { apiV1Router } from "./routes";

/** Builds the Express app WITHOUT starting a listener — used by both server.ts and the test suite (supertest). */
export function createApp(): Express {
  const app = express();

  // Assumes deployment behind a trusted reverse proxy (nginx, a PaaS load
  // balancer, etc.) — X-Forwarded-For is then trusted for req.ip, which
  // both the login rate limiter (keyed by IP+email) and every audit
  // entry's ipAddress rely on. If this app is ever directly
  // internet-facing instead, this MUST be removed or restricted to known
  // proxy IPs, or a client can spoof X-Forwarded-For to dodge rate
  // limiting and forge audit log IPs — see docs/SECURITY.md.
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: corsAllowedOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestId);
  app.use(autoAudit);

  app.get("/health", (_req, res) => {
    const body: HealthCheckResponse = {
      status: "ok",
      service: "prahari-api",
      timestamp: new Date().toISOString(),
    };
    res.json(body);
  });

  app.use("/api/v1", apiV1Router);

  app.use(errorHandler);

  return app;
}
