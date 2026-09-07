import type { RequestHandler } from "express";
import { hasPermission } from "../lib/permissions";

/** Checks the authenticated user's role against the RBAC matrix in packages/shared/src/config/permissions.json. Must run after `authenticate`. */
export function requirePermission(permission: string): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!hasPermission(req.auth.role, permission)) {
      res.status(403).json({ error: `Missing permission: ${permission}` });
      return;
    }
    next();
  };
}

/** Passes if the caller holds AT LEAST ONE of the given permissions — for a
 * route two structurally different roles can reach for different reasons
 * (e.g. POST /decisions: DISTRICT_OFFICER via `recommendation:approve`,
 * STATE_ADMIN via `recommendation:approveEscalated`). This only answers
 * "can this role ever reach this route" — the route handler still owns any
 * finer-grained, per-request authorization (e.g. STATE_ADMIN may act only
 * on a recommendation that is actually escalated). */
export function requireAnyPermission(...permissions: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!permissions.some((permission) => hasPermission(req.auth!.role, permission))) {
      res.status(403).json({ error: `Missing permission: one of [${permissions.join(", ")}]` });
      return;
    }
    next();
  };
}
