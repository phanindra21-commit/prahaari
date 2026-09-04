import type { Types } from "mongoose";
import { District, type DistrictDoc } from "../models/District";

/** Verifies `districtId` both exists AND is within the authenticated user's
 * scope, in one pre-query filter — never a post-hoc check on an already-fetched doc. */
export async function requireDistrictInScope(
  scopeFilter: Record<string, unknown> | undefined,
  districtId: Types.ObjectId,
): Promise<DistrictDoc | null> {
  return District.findOne({ _id: districtId, ...scopeFilter });
}
