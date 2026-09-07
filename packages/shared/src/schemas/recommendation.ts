import { z } from "zod";
import {
  objectIdSchema,
  priorityBucketSchema,
  recommendationStatusSchema,
  escalationStatusSchema,
  timestampsSchema,
  zoneClassSchema,
  geoLineStringSchema,
} from "./common";

/** Step 10 Part 3B: a route's per-zone-class distance/share breakdown. */
export const routeExposureSchema = z.object({
  zoneClass: zoneClassSchema,
  km: z.number().nonnegative(),
  percent: z.number().min(0).max(100),
});
export type RouteExposure = z.infer<typeof routeExposureSchema>;

/** The safest (A*-routed) corridor and a straight-line reference between
 * one habitation and one candidate site — see services/ml/app/engine/
 * routing.py and docs/METHODOLOGY.md's routing scope note. */
export const routeInfoSchema = z.object({
  routeGeometry: geoLineStringSchema,
  directGeometry: geoLineStringSchema,
  routeLengthKm: z.number().nonnegative(),
  directLengthKm: z.number().nonnegative(),
  detourRatio: z.number().nonnegative(),
  routeExposure: z.array(routeExposureSchema),
  directExposure: z.array(routeExposureSchema),
});
export type RouteInfo = z.infer<typeof routeInfoSchema>;

export const rankedCandidateSiteSchema = z.object({
  relocationSiteId: objectIdSchema,
  rank: z.number().int().positive(),
  suitabilityScore: z.number().min(0).max(1),
  route: routeInfoSchema.nullable().optional(),
  routeSafetyScore: z.number().min(0).max(1).nullable().optional(),
});
export type RankedCandidateSite = z.infer<typeof rankedCandidateSiteSchema>;

export const phasingPlanEntrySchema = z.object({
  phase: z.number().int().positive(),
  householdCount: z.number().int().nonnegative(),
  targetDate: z.date(),
});
export type PhasingPlanEntry = z.infer<typeof phasingPlanEntrySchema>;

/** Set by a DISTRICT_OFFICER's (or SUPER_ADMIN's, on their behalf) ESCALATE
 * decision — the documented exception that lets a STATE_ADMIN act on this
 * one recommendation despite normally being barred from approving (see
 * docs/SECURITY.md). Escalating does not itself decide the recommendation:
 * `status` stays PENDING_REVIEW until an actual APPROVE/MODIFY/REJECT/DEFER
 * is recorded, by either the district officer or (now unlocked) the state
 * admin. */
export const escalationSchema = z.object({
  status: escalationStatusSchema,
  escalatedBy: objectIdSchema.nullable(),
  escalatedAt: z.date().nullable(),
  reason: z.string().nullable(),
});
export type Escalation = z.infer<typeof escalationSchema>;

/** A system-generated pairing of a habitation with its ranked candidate relocation sites. */
export const recommendationSchema = z
  .object({
    _id: objectIdSchema,
    habitationId: objectIdSchema,
    districtId: objectIdSchema,
    candidateSites: z.array(rankedCandidateSiteSchema).min(1),
    selectedSiteId: objectIdSchema.nullable(),
    priorityBucket: priorityBucketSchema,
    estimatedHouseholdsToMove: z.number().int().nonnegative(),
    phasing: z.array(phasingPlanEntrySchema),
    rationale: z.string().min(1),
    modelVersion: z.string().min(1),
    status: recommendationStatusSchema,
    escalation: escalationSchema,
    generatedAt: z.date(),
  })
  .merge(timestampsSchema);
export type Recommendation = z.infer<typeof recommendationSchema>;
