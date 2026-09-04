import type { Types } from "mongoose";
import { District, type DistrictDoc } from "../models/District";
import { buildScopeFilter, type AuthScope } from "./scope";

/**
 * Verifies `districtId` both exists AND is within the authenticated user's
 * scope, in one pre-query filter — never a post-hoc check on an
 * already-fetched doc.
 *
 * Deliberately re-derives its own scope filter from `auth` scoped to the
 * District collection's own `_id` (`buildScopeFilter(auth, { districtField:
 * "_id" })`) rather than accepting a caller's `req.scopeFilter` — that
 * filter is built by each route's own `requireScope()` call for a
 * DIFFERENT collection (Habitation/GridCell/Assessment, keyed by their
 * own `districtId` field), and a District document has no `districtId`
 * field of its own to match against; reusing it here would either
 * silently match nothing (Habitation-shaped key `districtId` present but
 * meaningless on District) or, worse, be silently stripped by Mongoose's
 * strictQuery and match every district regardless of scope. The two `_id`
 * conditions are combined with `$and` rather than object-spread merged,
 * since spreading a second `_id` key into the same object would silently
 * overwrite the first instead of intersecting them.
 */
export async function requireDistrictInScope(
  auth: AuthScope,
  districtId: Types.ObjectId,
): Promise<DistrictDoc | null> {
  const scopeFilter = await buildScopeFilter(auth, { districtField: "_id" });
  return District.findOne({ $and: [{ _id: districtId }, scopeFilter] });
}
