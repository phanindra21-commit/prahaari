import { Schema, model, type Document } from "mongoose";
import { HAZARD_TYPES } from "@prahari/shared";
import type { HazardType } from "@prahari/shared";

export interface ModelMetrics {
  aucRoc: number;
  precision: number;
  recall: number;
  f1: number;
  calibrationError: number;
}

/**
 * `labelSource` is always "SYNTHETIC_DEMO" in this build — every model
 * trained by services/ml/app/engine/train.py learns from synthetic
 * labels (services/ml/app/engine/labels.py), never real historical
 * hazard inventory. See docs/ZONING_PIPELINE.md for how a real GSI/CWC
 * inventory would be swapped in.
 */
export interface ModelRunDoc extends Document {
  modelVersion: string;
  hazardType: HazardType;
  algorithm: string;
  trainedAt: Date;
  featureList: string[];
  hyperparameters: Record<string, unknown>;
  metrics: ModelMetrics;
  trainingSampleCount: number;
  labelSource: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const modelMetricsSchema = new Schema<ModelMetrics>(
  {
    aucRoc: { type: Number, required: true, min: 0, max: 1 },
    precision: { type: Number, required: true, min: 0, max: 1 },
    recall: { type: Number, required: true, min: 0, max: 1 },
    f1: { type: Number, required: true, min: 0, max: 1 },
    calibrationError: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const modelRunSchema = new Schema<ModelRunDoc>(
  {
    modelVersion: { type: String, required: true, unique: true },
    hazardType: { type: String, enum: HAZARD_TYPES, required: true },
    algorithm: { type: String, required: true },
    trainedAt: { type: Date, required: true },
    featureList: { type: [String], required: true },
    hyperparameters: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    metrics: { type: modelMetricsSchema, required: true },
    trainingSampleCount: { type: Number, required: true, min: 1 },
    labelSource: { type: String, required: true },
    notes: { type: String },
  },
  { timestamps: true },
);

modelRunSchema.index({ hazardType: 1, trainedAt: -1 });

export const ModelRun = model<ModelRunDoc>("ModelRun", modelRunSchema, "modelRuns");
