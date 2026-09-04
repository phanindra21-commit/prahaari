import { z } from "zod";
import {
  objectIdSchema,
  hazardTypeSchema,
  zoneClassSchema,
  priorityBucketSchema,
  explanationEntrySchema,
  timestampsSchema,
} from "./common";

export const hazardExposureEntrySchema = z.object({
  hazardType: hazardTypeSchema,
  hazardScore: z.number().min(0).max(1),
  exposure: z.number().min(0).max(1),
  zoneClass: zoneClassSchema,
  disasterHistoryBoost: z.number().min(0).max(1).default(0),
});
export type HazardExposureEntry = z.infer<typeof hazardExposureEntrySchema>;

export const vulnerabilityDimensionScoresSchema = z.object({
  demographic: z.number().min(0).max(1),
  socioeconomic: z.number().min(0).max(1),
  structural: z.number().min(0).max(1),
  accessibility: z.number().min(0).max(1),
});
export type VulnerabilityDimensionScores = z.infer<typeof vulnerabilityDimensionScoresSchema>;

/**
 * Set only when a configured (trigger, mechanism) pair is independently
 * Red/Orange for BOTH hazards at this habitation — see
 * services/ml/app/engine/compound_hazard.py and docs/METHODOLOGY.md's
 * Compound Hazards section. When set, `governingHazard` on the parent
 * Assessment is the MECHANISM, not simply the larger raw score.
 */
export const compoundHazardEntrySchema = z.object({
  trigger: hazardTypeSchema,
  mechanism: hazardTypeSchema,
  triggerRisk: z.number().min(0).max(1),
  mechanismRisk: z.number().min(0).max(1),
  compoundRisk: z.number().min(0).max(1),
});
export type CompoundHazardEntry = z.infer<typeof compoundHazardEntrySchema>;

/**
 * The computed risk record for one habitation at one point in time.
 * Never mutated — versioned like HazardZone: a new pipeline run inserts a
 * new doc and closes (`validTo`) the previously-active one for the same
 * habitation, pointing `supersedes` at it.
 *
 * `relocationPriorityIndex`/`priorityBucket` are null for a habitation
 * whose zone class is Yellow/Green: METHODOLOGY §1.3 gates the RPI
 * pipeline on Red/Orange, but every intersected habitation is still
 * "recorded as assessed" (hazard exposure, VI, coping capacity, Risk) —
 * see docs/METHODOLOGY.md §3 and docs/SCORING_PIPELINE.md.
 */
export const assessmentSchema = z
  .object({
    _id: objectIdSchema,
    habitationId: objectIdSchema,
    districtId: objectIdSchema,
    hazardExposure: z.array(hazardExposureEntrySchema).min(1),
    vulnerabilityIndex: z.number().min(0).max(1),
    vulnerabilityDimensions: vulnerabilityDimensionScoresSchema,
    copingCapacity: z.number().min(0).max(1),
    compositeRiskScore: z.number().min(0).max(1),
    governingHazard: hazardTypeSchema,
    overallZoneClass: zoneClassSchema,
    relocationPriorityIndex: z.number().min(0).max(1).nullable(),
    priorityBucket: priorityBucketSchema.nullable(),
    modelVersion: z.string().min(1),
    computedAt: z.date(),
    validFrom: z.date(),
    validTo: z.date().nullable(),
    supersedes: objectIdSchema.nullable(),
    explanation: z.array(explanationEntrySchema),
    compoundHazard: compoundHazardEntrySchema.nullable().default(null),
  })
  .merge(timestampsSchema);
export type Assessment = z.infer<typeof assessmentSchema>;
