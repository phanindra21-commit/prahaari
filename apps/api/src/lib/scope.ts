import { District } from "../models/District";
import type { UserRole } from "@prahari/shared";

export interface AuthScope {
  role: UserRole;
  state?: string;
  districtId?: string;
}

export interface ScopeFilterOptions {
  /** Dot-path of the field on the target collection that holds a districtId. Defaults to "districtId". */
  districtField?: string;
}

/** Matches nothing — used when a role's scope is under-configured rather than silently returning {} (which would mean "everything"). */
const MATCH_NOTHING = { _id: { $exists: false } };

/**
 * Returns a Mongo filter FRAGMENT enforcing row-level access for `auth`,
 * to be merged into a query's filter object BEFORE it runs (e.g.
 * `Model.find({ ...baseFilter, ...(await buildScopeFilter(auth)) })`) —
 * never applied as a post-hoc check on documents already fetched, so a
 * scoped-out document is never even read from the database.
 *
 * - SUPER_ADMIN: `{}` (no restriction).
 * - STATE_ADMIN: restricted to districts belonging to their state —
 *   resolved via a lookup against the districts collection, since
 *   resource documents are scoped by `districtId`, not `state`, directly.
 * - ANALYST: restricted to their single assigned district — UNLESS seeded
 *   as a state-level analyst (`scope.state` set, no `scope.districtId`;
 *   demo-rehearsal Part 5), in which case it gets the same state-wide
 *   lookup as STATE_ADMIN. A district-level ANALYST (the more common case)
 *   still falls through to the districtId branch below.
 * - DISTRICT_OFFICER / FIELD_VOLUNTEER: restricted to their single
 *   assigned district.
 */
export async function buildScopeFilter(
  auth: AuthScope,
  options: ScopeFilterOptions = {},
): Promise<Record<string, unknown>> {
  const field = options.districtField ?? "districtId";

  if (auth.role === "SUPER_ADMIN") {
    return {};
  }

  if (auth.role === "STATE_ADMIN") {
    if (!auth.state) {
      return MATCH_NOTHING;
    }
    const districts = await District.find({ state: auth.state }, { _id: 1 }).lean();
    return { [field]: { $in: districts.map((d) => d._id) } };
  }

  if (auth.role === "ANALYST" && auth.state && !auth.districtId) {
    const districts = await District.find({ state: auth.state }, { _id: 1 }).lean();
    return { [field]: { $in: districts.map((d) => d._id) } };
  }

  if (!auth.districtId) {
    return MATCH_NOTHING;
  }
  return { [field]: auth.districtId };
}
