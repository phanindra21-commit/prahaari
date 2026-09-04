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
  /** Plain-language rendering of `factor` for the officer workbench to render as a sentence. */
  label?: string;
}

/**
 * The computed risk record for one habitation at one point in time. Never
 * mutated — versioned like HazardZone: a new pipeline run inserts a new
 * doc and closes (`validTo`) the previously-active one for the same
 * habitation, pointing `supersedes` at it (apps/api/src/lib/
 * assessmentVersioning.ts).
 *
 * `relocationPriorityIndex`/`priorityBucket` are null for a Yellow/Green
 * habitation: METHODOLOGY §1.3 gates the RPI pipeline on Red/Orange, but
 * every intersected habitation is still "recorded as assessed" (hazard
 * exposure, VI, coping capacity, Risk).
 */
export interface AssessmentDoc extends Document {
  habitationId: Types.ObjectId;
  hazardExposure: HazardExposureEntry[];
  vulnerabilityIndex: number;
  vulnerabilityDimensions: VulnerabilityDimensionScores;
  copingCapacity: number;
  compositeRiskScore: number;
  relocationPriorityIndex: number | null;
  priorityBucket: RelocationPriorityBucket | null;
  modelVersion: string;
  computedAt: Date;
  validFrom: Date;
  validTo: Date | null;
  supersedes: Types.ObjectId | null;
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
    label: { type: String },
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
    compositeRiskScore: { type: Number, required: true, min: 0, max: 1 },
    relocationPriorityIndex: { type: Number, min: 0, max: 1, default: null },
    priorityBucket: { type: String, enum: PRIORITY_BUCKETS, default: null },
    modelVersion: { type: String, required: true },
    computedAt: { type: Date, required: true },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, default: null },
    supersedes: { type: Schema.Types.ObjectId, ref: "Assessment", default: null },
    explanation: { type: [explanationEntrySchema], required: true, default: [] },
  },
  { timestamps: true },
);

assessmentSchema.index({ habitationId: 1, computedAt: -1 });
assessmentSchema.index({ habitationId: 1, validTo: 1 });

export const Assessment = model<AssessmentDoc>("Assessment", assessmentSchema, "assessments");
