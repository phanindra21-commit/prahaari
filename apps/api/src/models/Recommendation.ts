import { Schema, model, type Document, type Types } from "mongoose";
import { PRIORITY_BUCKETS, RECOMMENDATION_STATUSES } from "@punarvas/shared";
import type { RelocationPriorityBucket, RecommendationStatus } from "@punarvas/shared";

/**
 * `districtId` is denormalized from `habitationId`'s Habitation at
 * generation time — every scoped collection in this project carries its
 * own `districtId` so `requireScope()`'s default filter shape (`{districtId: ...}`)
 * works without a $lookup; Recommendation is queried directly (list/detail
 * routes, RBAC), never only reached via its habitation.
 */

export interface RankedCandidateSite {
  relocationSiteId: Types.ObjectId;
  rank: number;
  suitabilityScore: number;
}

export interface PhasingPlanEntry {
  phase: number;
  householdCount: number;
  targetDate: Date;
}

/** A system-generated pairing of one habitation with its ranked candidate relocation sites. */
export interface RecommendationDoc extends Document {
  habitationId: Types.ObjectId;
  districtId: Types.ObjectId;
  candidateSites: RankedCandidateSite[];
  /** The officer's chosen site — defaults to candidateSites[0] (the
   * system's top-ranked site) at generation time; a MODIFY decision can
   * repoint it at any other ranked candidate. Null only if a district's
   * site-scoring produced zero ranked candidates for this habitation
   * (should not happen once Recommendation exists, but kept nullable for
   * defense-in-depth). */
  selectedSiteId: Types.ObjectId | null;
  priorityBucket: RelocationPriorityBucket;
  estimatedHouseholdsToMove: number;
  phasing: PhasingPlanEntry[];
  rationale: string;
  modelVersion: string;
  status: RecommendationStatus;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const rankedCandidateSiteSchema = new Schema<RankedCandidateSite>(
  {
    relocationSiteId: { type: Schema.Types.ObjectId, ref: "RelocationSite", required: true },
    rank: { type: Number, required: true, min: 1 },
    suitabilityScore: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const phasingPlanEntrySchema = new Schema<PhasingPlanEntry>(
  {
    phase: { type: Number, required: true, min: 1 },
    householdCount: { type: Number, required: true, min: 0 },
    targetDate: { type: Date, required: true },
  },
  { _id: false },
);

const recommendationSchema = new Schema<RecommendationDoc>(
  {
    habitationId: { type: Schema.Types.ObjectId, ref: "Habitation", required: true },
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    candidateSites: { type: [rankedCandidateSiteSchema], required: true },
    selectedSiteId: { type: Schema.Types.ObjectId, ref: "RelocationSite", default: null },
    priorityBucket: { type: String, enum: PRIORITY_BUCKETS, required: true },
    estimatedHouseholdsToMove: { type: Number, required: true, min: 0 },
    phasing: { type: [phasingPlanEntrySchema], required: true, default: [] },
    rationale: { type: String, required: true },
    modelVersion: { type: String, required: true },
    status: {
      type: String,
      enum: RECOMMENDATION_STATUSES,
      required: true,
      default: "PENDING_REVIEW",
    },
    generatedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

recommendationSchema.index({ habitationId: 1, status: 1 });
recommendationSchema.index({ districtId: 1, priorityBucket: 1, status: 1 });

export const Recommendation = model<RecommendationDoc>(
  "Recommendation",
  recommendationSchema,
  "recommendations",
);
