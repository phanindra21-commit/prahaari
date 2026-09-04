import { z } from "zod";
import {
  objectIdSchema,
  geoPolygonSchema,
  geoPointSchema,
  landOwnershipTypeSchema,
  dataProvenanceSchema,
  timestampsSchema,
} from "./common";

export const bindingConstraintSchema = z.enum(["LAND", "WATER", "EDUCATION", "HEALTH", "ACCESS"]);

export const carryingCapacitySchema = z.object({
  byLand: z.number().nonnegative(),
  byWater: z.number().nonnegative(),
  byEducation: z.number().nonnegative(),
  byHealth: z.number().nonnegative(),
  byAccess: z.number().nonnegative(),
  effectiveCapacity: z.number().nonnegative(),
  bindingConstraint: bindingConstraintSchema,
});
export type CarryingCapacity = z.infer<typeof carryingCapacitySchema>;

export const suitabilitySubScoresSchema = z.record(z.string(), z.number().min(0).max(1));

/** The raw SYNTHETIC_DEMO inputs the exclusions/suitability/capacity engine
 * computes from — see apps/api/src/models/RelocationSite.ts's docstring. */
export const relocationSiteRawAttributesSchema = z.object({
  slopeDegrees: z.number().nonnegative(),
  inCrzI: z.boolean(),
  inProtectedForest: z.boolean(),
  inFloodplain100yr: z.boolean(),
  distanceToActiveFaultM: z.number().nonnegative(),
  distanceToWaterBodyM: z.number().nonnegative(),
  inMiningLease: z.boolean(),
  distanceToAllWeatherRoadM: z.number().nonnegative(),
  availableWaterSupplyLpd: z.number().nonnegative(),
  nearbySchoolSpareCapacitySeats: z.number().nonnegative(),
  nearbyHealthFacilitySpareCapacityPopulation: z.number().nonnegative(),
  existingInfrastructureIndex: z.number().min(0).max(1),
});
export type RelocationSiteRawAttributes = z.infer<typeof relocationSiteRawAttributesSchema>;

export const relocationSiteSchema = z
  .object({
    _id: objectIdSchema,
    districtId: objectIdSchema,
    name: z.string().min(1),
    geometry: geoPolygonSchema,
    centroid: geoPointSchema,
    areaSqm: z.number().positive(),
    landOwnership: landOwnershipTypeSchema,
    rawAttributes: relocationSiteRawAttributesSchema,
    exclusionsPassed: z.array(z.string()),
    exclusionsFailed: z.array(z.string()),
    suitabilitySubScores: suitabilitySubScoresSchema,
    overallSuitabilityScore: z.number().min(0).max(1).nullable(),
    carryingCapacity: carryingCapacitySchema.nullable(),
    scoredAt: z.date().nullable(),
    modelVersion: z.string().nullable(),
    dataProvenance: dataProvenanceSchema,
    sourceUrl: z.string().url().optional(),
  })
  .merge(timestampsSchema);
export type RelocationSite = z.infer<typeof relocationSiteSchema>;
