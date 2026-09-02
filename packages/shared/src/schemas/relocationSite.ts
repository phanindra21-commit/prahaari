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

export const relocationSiteSchema = z
  .object({
    _id: objectIdSchema,
    districtId: objectIdSchema,
    name: z.string().min(1),
    geometry: geoPolygonSchema,
    centroid: geoPointSchema,
    areaSqm: z.number().positive(),
    landOwnership: landOwnershipTypeSchema,
    exclusionsPassed: z.array(z.string()),
    exclusionsFailed: z.array(z.string()),
    suitabilitySubScores: suitabilitySubScoresSchema,
    overallSuitabilityScore: z.number().min(0).max(1).nullable(),
    carryingCapacity: carryingCapacitySchema.nullable(),
    dataProvenance: dataProvenanceSchema,
    sourceUrl: z.string().url().optional(),
  })
  .merge(timestampsSchema);
export type RelocationSite = z.infer<typeof relocationSiteSchema>;
