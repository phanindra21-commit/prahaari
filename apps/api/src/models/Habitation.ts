import { Schema, model, type Document, type Types } from "mongoose";
import { CONSENT_STATUSES, DATA_PROVENANCE_VALUES } from "@punarvas/shared";
import type { ConsentStatus, DataProvenance, GeoPoint, GeoPolygon } from "@punarvas/shared";
import { geoPointSchema, geoPolygonalSchema } from "./geoSchemas";

export type FoundationType = "NONE" | "RUBBLE" | "STONE_MASONRY" | "RCC";
export type PrimaryOccupation =
  | "AGRICULTURE"
  | "PLANTATION"
  | "FISHERIES"
  | "DAILY_WAGE_LABOUR"
  | "TRADE"
  | "GOVERNMENT_SERVICE"
  | "OTHER";

const FOUNDATION_TYPES: FoundationType[] = ["NONE", "RUBBLE", "STONE_MASONRY", "RCC"];
const PRIMARY_OCCUPATIONS: PrimaryOccupation[] = [
  "AGRICULTURE",
  "PLANTATION",
  "FISHERIES",
  "DAILY_WAGE_LABOUR",
  "TRADE",
  "GOVERNMENT_SERVICE",
  "OTHER",
];

export interface HabitationDemographics {
  shareUnder5: number;
  shareOver60: number;
  womenHeadedHouseholdShare: number;
  disabledPersonsShare: number;
  bplShare: number;
  scStShare: number;
  literacyRate: number;
}

export interface HabitationStructures {
  kutchaHousingShare: number;
  avgBuildingAgeYears: number;
  predominantFoundationType: FoundationType;
}

export interface HabitationAccess {
  distanceToAllWeatherRoadKm: number;
  distanceToPhcKm: number;
  mobileNetworkCoverage: number;
  evacuationRouteCount: number;
}

export interface HabitationLivelihood {
  primaryOccupation: PrimaryOccupation;
  distanceToLivelihoodAssetKm: number;
  primaryLivelihoodDependenceShare: number;
}

/** Raw inputs for METHODOLOGY §2.2's CopingCapacity index. */
export interface HabitationCopingCapacity {
  sdrfResponseTimeMinutes: number;
  shelterWithin2km: boolean;
  communityTaskForcePresent: boolean;
  earlyWarningCoverage: number;
}

export interface HabitationDoc extends Document {
  lgdHabitationCode: string;
  name: string;
  block: string;
  panchayat: string;
  districtId: Types.ObjectId;
  centroid: GeoPoint;
  boundary?: GeoPolygon;
  population: number;
  households: number;
  demographics: HabitationDemographics;
  structures: HabitationStructures;
  access: HabitationAccess;
  livelihood: HabitationLivelihood;
  copingCapacity: HabitationCopingCapacity;
  consentStatus: ConsentStatus;
  dataProvenance: DataProvenance;
  sourceUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const demographicsSchema = new Schema<HabitationDemographics>(
  {
    shareUnder5: { type: Number, required: true, min: 0, max: 1 },
    shareOver60: { type: Number, required: true, min: 0, max: 1 },
    womenHeadedHouseholdShare: { type: Number, required: true, min: 0, max: 1 },
    disabledPersonsShare: { type: Number, required: true, min: 0, max: 1 },
    bplShare: { type: Number, required: true, min: 0, max: 1 },
    scStShare: { type: Number, required: true, min: 0, max: 1 },
    literacyRate: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const structuresSchema = new Schema<HabitationStructures>(
  {
    kutchaHousingShare: { type: Number, required: true, min: 0, max: 1 },
    avgBuildingAgeYears: { type: Number, required: true, min: 0 },
    predominantFoundationType: { type: String, enum: FOUNDATION_TYPES, required: true },
  },
  { _id: false },
);

const accessSchema = new Schema<HabitationAccess>(
  {
    distanceToAllWeatherRoadKm: { type: Number, required: true, min: 0 },
    distanceToPhcKm: { type: Number, required: true, min: 0 },
    mobileNetworkCoverage: { type: Number, required: true, min: 0, max: 1 },
    evacuationRouteCount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const livelihoodSchema = new Schema<HabitationLivelihood>(
  {
    primaryOccupation: { type: String, enum: PRIMARY_OCCUPATIONS, required: true },
    distanceToLivelihoodAssetKm: { type: Number, required: true, min: 0 },
    primaryLivelihoodDependenceShare: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const copingCapacitySchema = new Schema<HabitationCopingCapacity>(
  {
    sdrfResponseTimeMinutes: { type: Number, required: true, min: 0 },
    shelterWithin2km: { type: Boolean, required: true },
    communityTaskForcePresent: { type: Boolean, required: true },
    earlyWarningCoverage: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const habitationSchema = new Schema<HabitationDoc>(
  {
    lgdHabitationCode: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    block: { type: String, required: true, trim: true },
    panchayat: { type: String, required: true, trim: true },
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    centroid: { type: geoPointSchema, required: true },
    boundary: { type: geoPolygonalSchema },
    population: { type: Number, required: true, min: 0 },
    households: { type: Number, required: true, min: 0 },
    demographics: { type: demographicsSchema, required: true },
    structures: { type: structuresSchema, required: true },
    access: { type: accessSchema, required: true },
    livelihood: { type: livelihoodSchema, required: true },
    copingCapacity: { type: copingCapacitySchema, required: true },
    consentStatus: { type: String, enum: CONSENT_STATUSES, required: true, default: "NOT_ENGAGED" },
    dataProvenance: { type: String, enum: DATA_PROVENANCE_VALUES, required: true },
    sourceUrl: { type: String },
  },
  { timestamps: true },
);

habitationSchema.index({ centroid: "2dsphere" });
habitationSchema.index({ boundary: "2dsphere" });
habitationSchema.index({ districtId: 1 });

export const Habitation = model<HabitationDoc>("Habitation", habitationSchema, "habitations");
