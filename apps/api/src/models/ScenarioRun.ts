import { Schema, model, type Document, type Types } from "mongoose";
import { HAZARD_TYPES, ZONE_CLASSES } from "@punarvas/shared";
import type { HazardType, ZoneClass } from "@punarvas/shared";

export interface ScenarioParameters {
  rainfallMmPer24h?: number;
  seaLevelRiseM?: number;
  cycloneCategory?: number;
}

export interface AffectedZoneDelta {
  hazardZoneId: Types.ObjectId;
  hazardType: HazardType;
  previousZoneClass: ZoneClass;
  projectedZoneClass: ZoneClass;
  scoreDelta: number;
}

/** A saved what-if scenario, e.g. "+50mm/24h rainfall" or "+0.5m sea level rise". */
export interface ScenarioRunDoc extends Document {
  name: string;
  parameters: ScenarioParameters;
  affectedZoneDeltas: AffectedZoneDelta[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const scenarioParametersSchema = new Schema<ScenarioParameters>(
  {
    rainfallMmPer24h: { type: Number, min: 0 },
    seaLevelRiseM: { type: Number, min: 0 },
    cycloneCategory: { type: Number, min: 1, max: 5 },
  },
  { _id: false },
);

const affectedZoneDeltaSchema = new Schema<AffectedZoneDelta>(
  {
    hazardZoneId: { type: Schema.Types.ObjectId, ref: "HazardZone", required: true },
    hazardType: { type: String, enum: HAZARD_TYPES, required: true },
    previousZoneClass: { type: String, enum: ZONE_CLASSES, required: true },
    projectedZoneClass: { type: String, enum: ZONE_CLASSES, required: true },
    scoreDelta: { type: Number, required: true },
  },
  { _id: false },
);

const scenarioRunSchema = new Schema<ScenarioRunDoc>(
  {
    name: { type: String, required: true, trim: true },
    parameters: { type: scenarioParametersSchema, required: true },
    affectedZoneDeltas: { type: [affectedZoneDeltaSchema], required: true, default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

scenarioRunSchema.index({ createdBy: 1, createdAt: -1 });

export const ScenarioRun = model<ScenarioRunDoc>("ScenarioRun", scenarioRunSchema, "scenarioRuns");
