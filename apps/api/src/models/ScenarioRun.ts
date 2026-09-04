import { Schema, model, type Document, type Types } from "mongoose";
import { HAZARD_TYPES, ZONE_CLASSES, PRIORITY_BUCKETS } from "@punarvas/shared";
import type { HazardType, ZoneClass, RelocationPriorityBucket } from "@punarvas/shared";

/**
 * A saved what-if scenario (Step 8 Part 2), e.g. "2024 Wayanad event:
 * 372mm/24h" or "Cyclone Phailin: Category 4". Results are stored HERE
 * only — a scenario run never writes a HazardZone, Assessment, or any
 * other document the live pipeline produces; the district's active
 * zoning is untouched (see services/ml/app/engine/scenario.py's module
 * docstring and CLAUDE.md's human-in-the-loop principle: a scenario is
 * advisory and hypothetical, never auto-applied).
 */

export interface ScenarioParameters {
  rainfallMmPer24h?: number;
  seaLevelRiseM?: number;
  cycloneCategory?: number;
}

export interface HazardCellSummary {
  hazardType: HazardType;
  affected: boolean;
  baselineZoneCounts: Record<ZoneClass, number>;
  scenarioZoneCounts: Record<ZoneClass, number>;
  cellsChanged: number;
  newlyRedCells: number;
}

export interface CellClassTransition {
  hazardType: HazardType;
  fromZoneClass: ZoneClass;
  toZoneClass: ZoneClass;
  cellCount: number;
}

/** Only habitations whose overall zone class or priority bucket actually
 * changed are recorded — the delta is the story (Part 2B), not a full
 * restatement of every unaffected habitation. */
export interface HabitationDelta {
  habitationId: Types.ObjectId;
  habitationName: string;
  baselineOverallZoneClass: ZoneClass;
  scenarioOverallZoneClass: ZoneClass;
  baselinePriorityBucket: RelocationPriorityBucket | null;
  scenarioPriorityBucket: RelocationPriorityBucket | null;
  enteredImmediate: boolean;
  zoneClassWorsened: boolean;
}

export interface HazardZoneGeometry {
  hazardType: HazardType;
  /** zoneClass -> dissolved GeoJSON geometry, baseline (unperturbed) run. */
  baseline: Record<string, unknown>;
  /** zoneClass -> dissolved GeoJSON geometry, scenario (perturbed) run. */
  scenario: Record<string, unknown>;
  /** Dissolved geometry of every cell whose class changed at all — the
   * map's "highlight what changed" overlay. Null if nothing changed. */
  changed: Record<string, unknown> | null;
}

export interface ScenarioRunDoc extends Document {
  name: string;
  districtId: Types.ObjectId;
  hazardTypes: HazardType[];
  parameters: ScenarioParameters;
  hazardSummaries: HazardCellSummary[];
  cellTransitions: CellClassTransition[];
  habitationDeltas: HabitationDelta[];
  habitationsEnteringImmediate: string[];
  zoneGeometries: HazardZoneGeometry[];
  runtimeSeconds: number;
  modelVersion: string;
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

const zoneCountsSchema = new Schema(
  {
    Red: { type: Number, required: true, default: 0 },
    Orange: { type: Number, required: true, default: 0 },
    Yellow: { type: Number, required: true, default: 0 },
    Green: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const hazardCellSummarySchema = new Schema<HazardCellSummary>(
  {
    hazardType: { type: String, enum: HAZARD_TYPES, required: true },
    affected: { type: Boolean, required: true },
    baselineZoneCounts: { type: zoneCountsSchema, required: true },
    scenarioZoneCounts: { type: zoneCountsSchema, required: true },
    cellsChanged: { type: Number, required: true, min: 0 },
    newlyRedCells: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const cellClassTransitionSchema = new Schema<CellClassTransition>(
  {
    hazardType: { type: String, enum: HAZARD_TYPES, required: true },
    fromZoneClass: { type: String, enum: ZONE_CLASSES, required: true },
    toZoneClass: { type: String, enum: ZONE_CLASSES, required: true },
    cellCount: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const habitationDeltaSchema = new Schema<HabitationDelta>(
  {
    habitationId: { type: Schema.Types.ObjectId, ref: "Habitation", required: true },
    habitationName: { type: String, required: true },
    baselineOverallZoneClass: { type: String, enum: ZONE_CLASSES, required: true },
    scenarioOverallZoneClass: { type: String, enum: ZONE_CLASSES, required: true },
    baselinePriorityBucket: { type: String, enum: PRIORITY_BUCKETS, default: null },
    scenarioPriorityBucket: { type: String, enum: PRIORITY_BUCKETS, default: null },
    enteredImmediate: { type: Boolean, required: true },
    zoneClassWorsened: { type: Boolean, required: true },
  },
  { _id: false },
);

const hazardZoneGeometrySchema = new Schema<HazardZoneGeometry>(
  {
    hazardType: { type: String, enum: HAZARD_TYPES, required: true },
    baseline: { type: Schema.Types.Mixed, required: true },
    scenario: { type: Schema.Types.Mixed, required: true },
    changed: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const scenarioRunSchema = new Schema<ScenarioRunDoc>(
  {
    name: { type: String, required: true, trim: true },
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    hazardTypes: { type: [String], enum: HAZARD_TYPES, required: true },
    parameters: { type: scenarioParametersSchema, required: true },
    hazardSummaries: { type: [hazardCellSummarySchema], required: true, default: [] },
    cellTransitions: { type: [cellClassTransitionSchema], required: true, default: [] },
    habitationDeltas: { type: [habitationDeltaSchema], required: true, default: [] },
    habitationsEnteringImmediate: { type: [String], required: true, default: [] },
    zoneGeometries: { type: [hazardZoneGeometrySchema], required: true, default: [] },
    runtimeSeconds: { type: Number, required: true, min: 0 },
    modelVersion: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

scenarioRunSchema.index({ districtId: 1, createdAt: -1 });
scenarioRunSchema.index({ createdBy: 1, createdAt: -1 });

export const ScenarioRun = model<ScenarioRunDoc>("ScenarioRun", scenarioRunSchema, "scenarioRuns");
