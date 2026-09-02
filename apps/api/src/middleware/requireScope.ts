import type { RequestHandler } from "express";
import { buildScopeFilter, type ScopeFilterOptions } from "../lib/scope";

/**
 * Computes the row-level Mongo filter fragment for the authenticated
 * user and attaches it to `req.scopeFilter` — route handlers merge it
 * into their query filter (e.g. `Model.find({ ...req.scopeFilter, ...otherFilters })`).
 * This enforces scope BEFORE the query runs, not as a post-hoc check on
 * already-fetched documents. Must run after `authenticate`.
 */
export function requireScope(options?: ScopeFilterOptions): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    buildScopeFilter(req.auth, options)
      .then((filter) => {
        req.scopeFilter = filter;
        next();
      })
      .catch(next);
  };
}
