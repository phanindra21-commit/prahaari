import { z } from "zod";
import {
  objectIdSchema,
  priorityBucketSchema,
  recommendationStatusSchema,
  timestampsSchema,
} from "./common";

export const rankedCandidateSiteSchema = z.object({
  relocationSiteId: objectIdSchema,
  rank: z.number().int().positive(),
  suitabilityScore: z.number().min(0).max(1),
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
