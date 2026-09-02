import { Schema, model, type Document, type Types } from "mongoose";
import {
  HAZARD_TYPES,
  HAZARD_EVENT_SOURCES,
  EVENT_CONFIDENCE_LEVELS,
  DATA_PROVENANCE_VALUES,
} from "@punarvas/shared";
import type {
  HazardType,
  HazardEventSource,
  EventConfidence,
  DataProvenance,
  GeoPoint,
  GeoPolygonal,
} from "@punarvas/shared";
export interface HazardEventDoc extends Document {
  districtId: Types.ObjectId;
  hazardType: HazardType;
  name: string;
  date: Date;
  extent: GeoPoint | GeoPolygonal;
  deaths: number;
  injured: number;
  displaced: number;
  housesDamaged: number;
  economicLossInrLakh: number;
  source: HazardEventSource;
  confidence: EventConfidence;
  dataProvenance: DataProvenance;
  sourceUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const hazardEventSchema = new Schema<HazardEventDoc>(
  {
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    hazardType: { type: String, enum: HAZARD_TYPES, required: true },
    name: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    extent: { type: Schema.Types.Mixed, required: true },
    deaths: { type: Number, required: true, min: 0, default: 0 },
    injured: { type: Number, required: true, min: 0, default: 0 },
    displaced: { type: Number, required: true, min: 0, default: 0 },
    housesDamaged: { type: Number, required: true, min: 0, default: 0 },
    economicLossInrLakh: { type: Number, required: true, min: 0, default: 0 },
    source: { type: String, enum: HAZARD_EVENT_SOURCES, required: true },
    confidence: { type: String, enum: EVENT_CONFIDENCE_LEVELS, required: true },
    dataProvenance: { type: String, enum: DATA_PROVENANCE_VALUES, required: true },
    sourceUrl: { type: String },
  },
  { timestamps: true },
);

hazardEventSchema.index({ extent: "2dsphere" });
hazardEventSchema.index({ districtId: 1, hazardType: 1, date: -1 });

export const HazardEvent = model<HazardEventDoc>("HazardEvent", hazardEventSchema, "hazardEvents");
