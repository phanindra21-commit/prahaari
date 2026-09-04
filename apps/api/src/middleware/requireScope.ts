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
    // req.auth's scope fields are nested (`req.auth.scope.{state,districtId}`,
    // per types/express.d.ts) but buildScopeFilter's AuthScope is flat —
    // must destructure explicitly here, never pass req.auth through
    // directly: since state/districtId are OPTIONAL on AuthScope,
    // TypeScript accepts req.auth's nested shape as a structural match
    // without complaint, but auth.districtId/auth.state would then always
    // read as undefined at runtime, silently matching nothing for every
    // non-SUPER_ADMIN role.
    buildScopeFilter({ role: req.auth.role, ...req.auth.scope }, options)
      .then((filter) => {
        req.scopeFilter = filter;
        next();
      })
      .catch(next);
  };
}
