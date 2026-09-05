import { z } from "zod";
import {
  objectIdSchema,
  priorityBucketSchema,
  recommendationStatusSchema,
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
    generatedAt: z.date(),
  })
  .merge(timestampsSchema);
export type Recommendation = z.infer<typeof recommendationSchema>;
