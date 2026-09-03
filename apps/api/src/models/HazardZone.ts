import { Schema, model, type Document, type Types } from "mongoose";
import {
  HAZARD_TYPES,
  ZONE_CLASSES,
  GENERATED_BY_VALUES,
  DATA_PROVENANCE_VALUES,
} from "@punarvas/shared";
import type {
  HazardType,
  ZoneClass,
  GeneratedBy,
  DataProvenance,
  GeoPolygonal,
} from "@punarvas/shared";
import { geoPolygonalSchema } from "./geoSchemas";

/**
 * HazardZone documents are VERSIONED, never mutated: a new zoning run
 * inserts a new document and points `supersedes` at the previous
 * version's _id rather than updating that document in place. This
 * preserves a full history of how zoning has changed over time (see
 * ScenarioRun and docs/ARCHITECTURE.md).
 */
export interface HazardZoneDoc extends Document {
  districtId: Types.ObjectId;
  hazardType: HazardType;
  /** Full-resolution dissolved boundary — authoritative for audit/analysis/intersection tests. */
  geometry: GeoPolygonal;
  /** Simplified (shapely.simplify, ~50m tolerance) boundary for map rendering. Optional: seed-authored demo zones (data/seed/*-hazard-zones.geojson) are already simple hand-drawn shapes and never populate this. */
  simplifiedGeometry?: GeoPolygonal;
  zoneClass: ZoneClass;
  hazardScore: number;
  factorContributions: Map<string, number>;
  modelVersion: string;
  validFrom: Date;
  validTo: Date | null;
  generatedBy: GeneratedBy;
  supersedes: Types.ObjectId | null;
  dataProvenance: DataProvenance;
  sourceUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const hazardZoneSchema = new Schema<HazardZoneDoc>(
  {
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    hazardType: { type: String, enum: HAZARD_TYPES, required: true },
    geometry: { type: geoPolygonalSchema, required: true },
    simplifiedGeometry: { type: geoPolygonalSchema },
    zoneClass: { type: String, enum: ZONE_CLASSES, required: true },
    hazardScore: { type: Number, required: true, min: 0, max: 1 },
    factorContributions: { type: Map, of: Number, required: true, default: () => new Map() },
    modelVersion: { type: String, required: true },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, default: null },
    generatedBy: { type: String, enum: GENERATED_BY_VALUES, required: true },
    supersedes: { type: Schema.Types.ObjectId, ref: "HazardZone", default: null },
    dataProvenance: { type: String, enum: DATA_PROVENANCE_VALUES, required: true },
    sourceUrl: { type: String },
  },
  { timestamps: true },
);

hazardZoneSchema.index({ geometry: "2dsphere" });
hazardZoneSchema.index({ districtId: 1, hazardType: 1, validTo: 1 });

export const HazardZone = model<HazardZoneDoc>("HazardZone", hazardZoneSchema, "hazardZones");
