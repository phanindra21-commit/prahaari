import { Schema, model, type Document, type Types } from "mongoose";
import { ZONE_CLASSES, DATA_PROVENANCE_VALUES } from "@punarvas/shared";
import type { ZoneClass, DataProvenance, GeoPoint, GeoPolygonal } from "@punarvas/shared";
import { geoPointSchema, geoPolygonalSchema } from "./geoSchemas";

export interface HazardScoreEntry {
  overlayScore: number;
  mlScore: number;
  blendedScore: number;
  zoneClass: ZoneClass;
}

/**
 * `factors` is keyed hazardType -> factorName -> raw value, NOT flattened,
 * because the same factor name can mean different physical quantities for
 * different hazards (e.g. landCover is a forest-cover index for landslide
 * but an imperviousness index for flood) — see
 * packages/shared/src/config/hazard-weights.json.
 */
export interface GridCellDoc extends Document {
  h3Index: string;
  resolution: number;
  districtId: Types.ObjectId;
  centroid: GeoPoint;
  boundary: GeoPolygonal;
  factors: Record<string, Record<string, number>>;
  hazardScores: Map<string, HazardScoreEntry>;
  modelVersion: string;
  computedAt: Date;
  dataProvenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const hazardScoreEntrySchema = new Schema<HazardScoreEntry>(
  {
    overlayScore: { type: Number, required: true, min: 0, max: 1 },
    mlScore: { type: Number, required: true, min: 0, max: 1 },
    blendedScore: { type: Number, required: true, min: 0, max: 1 },
    zoneClass: { type: String, enum: ZONE_CLASSES, required: true },
  },
  { _id: false },
);

const gridCellSchema = new Schema<GridCellDoc>(
  {
    h3Index: { type: String, required: true, unique: true },
    resolution: { type: Number, required: true },
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    centroid: { type: geoPointSchema, required: true },
    boundary: { type: geoPolygonalSchema, required: true },
    factors: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    hazardScores: {
      type: Map,
      of: hazardScoreEntrySchema,
      required: true,
      default: () => new Map(),
    },
    modelVersion: { type: String, required: true },
    computedAt: { type: Date, required: true },
    dataProvenance: { type: String, enum: DATA_PROVENANCE_VALUES, required: true },
  },
  { timestamps: true },
);

gridCellSchema.index({ centroid: "2dsphere" });
gridCellSchema.index({ boundary: "2dsphere" });
gridCellSchema.index({ districtId: 1 });

export const GridCell = model<GridCellDoc>("GridCell", gridCellSchema, "gridCells");
