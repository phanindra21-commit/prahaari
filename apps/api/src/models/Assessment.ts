import { Schema, model, type Document, type Types } from "mongoose";
import { HAZARD_TYPES, PRIORITY_BUCKETS, EXPLANATION_DIRECTIONS } from "@punarvas/shared";
import type { HazardType, RelocationPriorityBucket, ExplanationDirection } from "@punarvas/shared";

export interface HazardExposureEntry {
  hazardType: HazardType;
  hazardScore: number;
  exposure: number;
}

export interface VulnerabilityDimensionScores {
  demographic: number;
  socioeconomic: number;
  structural: number;
  accessibility: number;
}

export interface ExplanationEntry {
  factor: string;
  contribution: number;
  direction: ExplanationDirection;
}

/** The computed risk record for one habitation at one point in time. */
export interface AssessmentDoc extends Document {
  habitationId: Types.ObjectId;
  hazardExposure: HazardExposureEntry[];
  vulnerabilityIndex: number;
  vulnerabilityDimensions: VulnerabilityDimensionScores;
  copingCapacity: number;
  compositeRiskScore: number;
  relocationPriorityIndex: number;
  priorityBucket: RelocationPriorityBucket;
  modelVersion: string;
  computedAt: Date;
  explanation: ExplanationEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const hazardExposureEntrySchema = new Schema<HazardExposureEntry>(
  {
    hazardType: { type: String, enum: HAZARD_TYPES, required: true },
    hazardScore: { type: Number, required: true, min: 0, max: 1 },
    exposure: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const vulnerabilityDimensionScoresSchema = new Schema<VulnerabilityDimensionScores>(
  {
    demographic: { type: Number, required: true, min: 0, max: 1 },
    socioeconomic: { type: Number, required: true, min: 0, max: 1 },
    structural: { type: Number, required: true, min: 0, max: 1 },
    accessibility: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const explanationEntrySchema = new Schema<ExplanationEntry>(
  {
    factor: { type: String, required: true },
    contribution: { type: Number, required: true },
    direction: { type: String, enum: EXPLANATION_DIRECTIONS, required: true },
  },
  { _id: false },
);

const assessmentSchema = new Schema<AssessmentDoc>(
  {
    habitationId: { type: Schema.Types.ObjectId, ref: "Habitation", required: true },
    hazardExposure: { type: [hazardExposureEntrySchema], required: true },
    vulnerabilityIndex: { type: Number, required: true, min: 0, max: 1 },
    vulnerabilityDimensions: { type: vulnerabilityDimensionScoresSchema, required: true },
    copingCapacity: { type: Number, required: true, min: 0, max: 1 },
    compositeRiskScore: { type: Number, required: true, min: 0 },
    relocationPriorityIndex: { type: Number, required: true, min: 0, max: 1 },
    priorityBucket: { type: String, enum: PRIORITY_BUCKETS, required: true },
    modelVersion: { type: String, required: true },
    computedAt: { type: Date, required: true },
    explanation: { type: [explanationEntrySchema], required: true, default: [] },
  },
  { timestamps: true },
);

assessmentSchema.index({ habitationId: 1, computedAt: -1 });

export const Assessment = model<AssessmentDoc>("Assessment", assessmentSchema, "assessments");
