import { Schema, model, type Document } from "mongoose";
import { HAZARD_TYPES, type HazardType, type GeoPolygonal } from "@punarvas/shared";
import { geoPolygonalSchema } from "./geoSchemas";

export interface DmAuthorityContact {
  name: string;
  designation: string;
  phone: string;
  email?: string;
}

export interface DistrictDoc extends Document {
  lgdCode: string;
  name: string;
  state: string;
  boundary: GeoPolygonal;
  population: number;
  areaSqKm: number;
  primaryHazards: HazardType[];
  dmAuthorityContact: DmAuthorityContact;
  createdAt: Date;
  updatedAt: Date;
}

const dmAuthorityContactSchema = new Schema<DmAuthorityContact>(
  {
    name: { type: String, required: true },
    designation: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String },
  },
  { _id: false },
);

const districtSchema = new Schema<DistrictDoc>(
  {
    lgdCode: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    boundary: { type: geoPolygonalSchema, required: true },
    population: { type: Number, required: true, min: 0 },
    areaSqKm: { type: Number, required: true, min: 0 },
    primaryHazards: { type: [String], enum: HAZARD_TYPES, required: true },
    dmAuthorityContact: { type: dmAuthorityContactSchema, required: true },
  },
  { timestamps: true },
);

districtSchema.index({ boundary: "2dsphere" });

export const District = model<DistrictDoc>("District", districtSchema, "districts");
