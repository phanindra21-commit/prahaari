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
