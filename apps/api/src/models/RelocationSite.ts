import { Schema, model, type Document, type Types } from "mongoose";
import { LAND_OWNERSHIP_TYPES, DATA_PROVENANCE_VALUES } from "@prahari/shared";
import type { LandOwnershipType, DataProvenance, GeoPoint, GeoPolygon } from "@prahari/shared";
import { geoPointSchema, geoPolygonalSchema } from "./geoSchemas";

export type BindingConstraint = "LAND" | "WATER" | "EDUCATION" | "HEALTH" | "ACCESS";
const BINDING_CONSTRAINTS: BindingConstraint[] = ["LAND", "WATER", "EDUCATION", "HEALTH", "ACCESS"];

export interface CarryingCapacity {
  byLand: number;
  byWater: number;
  byEducation: number;
  byHealth: number;
  byAccess: number;
  effectiveCapacity: number;
  bindingConstraint: BindingConstraint;
}

/**
 * The raw SYNTHETIC_DEMO inputs the exclusions/suitability/capacity
 * engine (services/ml/app/engine/{exclusions,suitability,capacity}.py)
 * computes from. Every field with no real GIS-layer equivalent in this
 * project (CRZ-I, protected forest, floodplain, active fault, mining
 * lease) is a deterministically-assigned synthetic value — same
 * convention as derive_factors.py's causative factors — set by
 * services/ml/scripts/add_site_attributes.py. `insideRedOrOrangeZone`
 * (METHODOLOGY §4.1) is the one exclusion criterion NOT sourced here:
 * it is computed live from this site's real `geometry` intersected
 * against active HazardZone documents.
 */
export interface RelocationSiteRawAttributes {
  slopeDegrees: number;
  inCrzI: boolean;
  inProtectedForest: boolean;
  inFloodplain100yr: boolean;
  distanceToActiveFaultM: number;
  distanceToWaterBodyM: number;
  inMiningLease: boolean;
  distanceToAllWeatherRoadM: number;
  availableWaterSupplyLpd: number;
  nearbySchoolSpareCapacitySeats: number;
  nearbyHealthFacilitySpareCapacityPopulation: number;
  existingInfrastructureIndex: number;
}

/**
 * A candidate relocation site. `overallSuitabilityScore` and
 * `carryingCapacity` are null for sites that FAILED one or more
 * exclusion criteria (see docs/METHODOLOGY.md Section 4.1) — such sites
 * are never scored, so there is nothing to store; `exclusionsFailed`
 * records which hard filter(s) removed them from consideration.
 */
export interface RelocationSiteDoc extends Document {
  districtId: Types.ObjectId;
  name: string;
  geometry: GeoPolygon;
  centroid: GeoPoint;
  areaSqm: number;
  landOwnership: LandOwnershipType;
  rawAttributes: RelocationSiteRawAttributes;
  exclusionsPassed: string[];
  exclusionsFailed: string[];
  suitabilitySubScores: Map<string, number>;
  overallSuitabilityScore: number | null;
  carryingCapacity: CarryingCapacity | null;
  scoredAt: Date | null;
  modelVersion: string | null;
  dataProvenance: DataProvenance;
  sourceUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const rawAttributesSchema = new Schema<RelocationSiteRawAttributes>(
  {
    slopeDegrees: { type: Number, required: true, min: 0 },
    inCrzI: { type: Boolean, required: true, default: false },
    inProtectedForest: { type: Boolean, required: true, default: false },
    inFloodplain100yr: { type: Boolean, required: true, default: false },
    distanceToActiveFaultM: { type: Number, required: true, min: 0 },
    distanceToWaterBodyM: { type: Number, required: true, min: 0 },
    inMiningLease: { type: Boolean, required: true, default: false },
    distanceToAllWeatherRoadM: { type: Number, required: true, min: 0 },
    availableWaterSupplyLpd: { type: Number, required: true, min: 0 },
    nearbySchoolSpareCapacitySeats: { type: Number, required: true, min: 0 },
    nearbyHealthFacilitySpareCapacityPopulation: { type: Number, required: true, min: 0 },
    existingInfrastructureIndex: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const carryingCapacitySchema = new Schema<CarryingCapacity>(
  {
    byLand: { type: Number, required: true, min: 0 },
    byWater: { type: Number, required: true, min: 0 },
    byEducation: { type: Number, required: true, min: 0 },
    byHealth: { type: Number, required: true, min: 0 },
    byAccess: { type: Number, required: true, min: 0 },
    effectiveCapacity: { type: Number, required: true, min: 0 },
    bindingConstraint: { type: String, enum: BINDING_CONSTRAINTS, required: true },
  },
  { _id: false },
);

const relocationSiteSchema = new Schema<RelocationSiteDoc>(
  {
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    name: { type: String, required: true, trim: true },
    geometry: { type: geoPolygonalSchema, required: true },
    centroid: { type: geoPointSchema, required: true },
    areaSqm: { type: Number, required: true, min: 0 },
    landOwnership: { type: String, enum: LAND_OWNERSHIP_TYPES, required: true },
    rawAttributes: { type: rawAttributesSchema, required: true },
    exclusionsPassed: { type: [String], required: true, default: [] },
    exclusionsFailed: { type: [String], required: true, default: [] },
    suitabilitySubScores: { type: Map, of: Number, required: true, default: () => new Map() },
    overallSuitabilityScore: { type: Number, min: 0, max: 1, default: null },
    carryingCapacity: { type: carryingCapacitySchema, default: null },
    scoredAt: { type: Date, default: null },
    modelVersion: { type: String, default: null },
    dataProvenance: { type: String, enum: DATA_PROVENANCE_VALUES, required: true },
    sourceUrl: { type: String },
  },
  { timestamps: true },
);

relocationSiteSchema.index({ geometry: "2dsphere" });
relocationSiteSchema.index({ centroid: "2dsphere" });
relocationSiteSchema.index({ districtId: 1 });

export const RelocationSite = model<RelocationSiteDoc>(
  "RelocationSite",
  relocationSiteSchema,
  "relocationSites",
);
