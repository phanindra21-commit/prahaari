import { Schema, model, type Document, type Types } from "mongoose";
import { PRIORITY_BUCKETS, RECOMMENDATION_STATUSES, ZONE_CLASSES, ESCALATION_STATUSES } from "@prahari/shared";
import type {
  RelocationPriorityBucket,
  RecommendationStatus,
  ZoneClass,
  GeoLineString,
  EscalationStatus,
} from "@prahari/shared";
import { geoLineStringSchema } from "./geoSchemas";

/**
 * `districtId` is denormalized from `habitationId`'s Habitation at
 * generation time — every scoped collection in this project carries its
 * own `districtId` so `requireScope()`'s default filter shape (`{districtId: ...}`)
 * works without a $lookup; Recommendation is queried directly (list/detail
 * routes, RBAC), never only reached via its habitation.
 */

export interface RouteExposureEntry {
  zoneClass: ZoneClass;
  km: number;
  percent: number;
}

/** Step 10 Part 3B: the safest (A*-routed) corridor and a straight-line
 * reference between this habitation and this candidate site — see
 * services/ml/app/engine/routing.py and docs/METHODOLOGY.md's routing
 * scope note (corridor-level over the hazard grid, not road-network
 * routing). Null when routing could not be computed for this pair (no
 * path found, or the pipeline run predates this feature). */
export interface RouteInfo {
  routeGeometry: GeoLineString;
  directGeometry: GeoLineString;
  routeLengthKm: number;
  directLengthKm: number;
  detourRatio: number;
  routeExposure: RouteExposureEntry[];
  directExposure: RouteExposureEntry[];
}

export interface RankedCandidateSite {
  relocationSiteId: Types.ObjectId;
  rank: number;
  suitabilityScore: number;
  route?: RouteInfo | null;
  routeSafetyScore?: number | null;
}

export interface PhasingPlanEntry {
  phase: number;
  householdCount: number;
  targetDate: Date;
}

/** Set by a DISTRICT_OFFICER's (or SUPER_ADMIN's, on their behalf) ESCALATE
 * decision — the documented exception letting a STATE_ADMIN act on this one
 * recommendation despite normally being barred from approving. Escalating
 * does not itself decide the recommendation — `status` stays PENDING_REVIEW
 * until an actual APPROVE/MODIFY/REJECT/DEFER is recorded. See
 * docs/SECURITY.md's escalation section. */
export interface RecommendationEscalation {
  status: EscalationStatus;
  escalatedBy: Types.ObjectId | null;
  escalatedAt: Date | null;
  reason: string | null;
}

/** A system-generated pairing of one habitation with its ranked candidate relocation sites. */
export interface RecommendationDoc extends Document {
  habitationId: Types.ObjectId;
  districtId: Types.ObjectId;
  candidateSites: RankedCandidateSite[];
  /** The officer's chosen site — defaults to candidateSites[0] (the
   * system's top-ranked site) at generation time; a MODIFY decision can
   * repoint it at any other ranked candidate. Null only if a district's
   * site-scoring produced zero ranked candidates for this habitation
   * (should not happen once Recommendation exists, but kept nullable for
   * defense-in-depth). */
  selectedSiteId: Types.ObjectId | null;
  priorityBucket: RelocationPriorityBucket;
  estimatedHouseholdsToMove: number;
  phasing: PhasingPlanEntry[];
  rationale: string;
  modelVersion: string;
  status: RecommendationStatus;
  escalation: RecommendationEscalation;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const routeExposureEntrySchema = new Schema<RouteExposureEntry>(
  {
    zoneClass: { type: String, enum: ZONE_CLASSES, required: true },
    km: { type: Number, required: true, min: 0 },
    percent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

const routeInfoSchema = new Schema<RouteInfo>(
  {
    routeGeometry: { type: geoLineStringSchema, required: true },
    directGeometry: { type: geoLineStringSchema, required: true },
    routeLengthKm: { type: Number, required: true, min: 0 },
    directLengthKm: { type: Number, required: true, min: 0 },
    detourRatio: { type: Number, required: true, min: 0 },
    routeExposure: { type: [routeExposureEntrySchema], required: true },
    directExposure: { type: [routeExposureEntrySchema], required: true },
  },
  { _id: false },
);

const rankedCandidateSiteSchema = new Schema<RankedCandidateSite>(
  {
    relocationSiteId: { type: Schema.Types.ObjectId, ref: "RelocationSite", required: true },
    rank: { type: Number, required: true, min: 1 },
    suitabilityScore: { type: Number, required: true, min: 0, max: 1 },
    route: { type: routeInfoSchema, default: null },
    routeSafetyScore: { type: Number, min: 0, max: 1, default: null },
  },
  { _id: false },
);

const phasingPlanEntrySchema = new Schema<PhasingPlanEntry>(
  {
    phase: { type: Number, required: true, min: 1 },
    householdCount: { type: Number, required: true, min: 0 },
    targetDate: { type: Date, required: true },
  },
  { _id: false },
);

const recommendationEscalationSchema = new Schema<RecommendationEscalation>(
  {
    status: { type: String, enum: ESCALATION_STATUSES, required: true, default: "NONE" },
    escalatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    escalatedAt: { type: Date, default: null },
    reason: { type: String, default: null },
  },
  { _id: false },
);

const recommendationSchema = new Schema<RecommendationDoc>(
  {
    habitationId: { type: Schema.Types.ObjectId, ref: "Habitation", required: true },
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    candidateSites: { type: [rankedCandidateSiteSchema], required: true },
    selectedSiteId: { type: Schema.Types.ObjectId, ref: "RelocationSite", default: null },
    priorityBucket: { type: String, enum: PRIORITY_BUCKETS, required: true },
    estimatedHouseholdsToMove: { type: Number, required: true, min: 0 },
    phasing: { type: [phasingPlanEntrySchema], required: true, default: [] },
    rationale: { type: String, required: true },
    modelVersion: { type: String, required: true },
    status: {
      type: String,
      enum: RECOMMENDATION_STATUSES,
      required: true,
      default: "PENDING_REVIEW",
    },
    escalation: { type: recommendationEscalationSchema, required: true, default: () => ({ status: "NONE" }) },
    generatedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

recommendationSchema.index({ habitationId: 1, status: 1 });
recommendationSchema.index({ districtId: 1, priorityBucket: 1, status: 1 });
recommendationSchema.index({ districtId: 1, "escalation.status": 1 });

export const Recommendation = model<RecommendationDoc>(
  "Recommendation",
  recommendationSchema,
  "recommendations",
);
