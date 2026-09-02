import { z } from "zod";
import {
  objectIdSchema,
  hazardTypeSchema,
  priorityBucketSchema,
  explanationEntrySchema,
  timestampsSchema,
} from "./common";

export const hazardExposureEntrySchema = z.object({
  hazardType: hazardTypeSchema,
  hazardScore: z.number().min(0).max(1),
  exposure: z.number().min(0).max(1),
});
export type HazardExposureEntry = z.infer<typeof hazardExposureEntrySchema>;

export const vulnerabilityDimensionScoresSchema = z.object({
  demographic: z.number().min(0).max(1),
  socioeconomic: z.number().min(0).max(1),
  structural: z.number().min(0).max(1),
  accessibility: z.number().min(0).max(1),
});
export type VulnerabilityDimensionScores = z.infer<typeof vulnerabilityDimensionScoresSchema>;

/** The computed risk record for one habitation at one point in time. */
export const assessmentSchema = z
  .object({
    _id: objectIdSchema,
    habitationId: objectIdSchema,
    hazardExposure: z.array(hazardExposureEntrySchema).min(1),
    vulnerabilityIndex: z.number().min(0).max(1),
    vulnerabilityDimensions: vulnerabilityDimensionScoresSchema,
    copingCapacity: z.number().min(0).max(1),
    compositeRiskScore: z.number().min(0),
    relocationPriorityIndex: z.number().min(0).max(1),
    priorityBucket: priorityBucketSchema,
    modelVersion: z.string().min(1),
    computedAt: z.date(),
    explanation: z.array(explanationEntrySchema),
  })
  .merge(timestampsSchema);
export type Assessment = z.infer<typeof assessmentSchema>;
