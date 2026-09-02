import { Schema, model, type Document, type Types } from "mongoose";
import { PRIORITY_BUCKETS, RECOMMENDATION_STATUSES } from "@punarvas/shared";
import type { RelocationPriorityBucket, RecommendationStatus } from "@punarvas/shared";

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
  candidateSites: RankedCandidateSite[];
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
    candidateSites: { type: [rankedCandidateSiteSchema], required: true },
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

export const Recommendation = model<RecommendationDoc>(
  "Recommendation",
  recommendationSchema,
  "recommendations",
);
