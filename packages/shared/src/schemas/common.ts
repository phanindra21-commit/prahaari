import { z } from "zod";
import {
  HAZARD_TYPES,
  ZONE_CLASSES,
  PRIORITY_BUCKETS,
  USER_ROLES,
  CONSENT_STATUSES,
  LAND_OWNERSHIP_TYPES,
  RECOMMENDATION_STATUSES,
  DECISION_ACTIONS,
  GENERATED_BY_VALUES,
  DATA_PROVENANCE_VALUES,
  HAZARD_EVENT_SOURCES,
  EVENT_CONFIDENCE_LEVELS,
  EXPLANATION_DIRECTIONS,
  AUDIT_SEVERITIES,
  FIELD_REPORT_OBSERVATION_TYPES,
  FIELD_REPORT_VERIFICATION_STATUSES,
  JOB_STATUSES,
  JOB_TYPES,
  NOTIFICATION_TYPES,
} from "../constants";

/** 24-character hex string — the wire representation of a Mongoose ObjectId. */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

export const hazardTypeSchema = z.enum(HAZARD_TYPES);
export const zoneClassSchema = z.enum(ZONE_CLASSES);
export const priorityBucketSchema = z.enum(PRIORITY_BUCKETS);
export const userRoleSchema = z.enum(USER_ROLES);
export const consentStatusSchema = z.enum(CONSENT_STATUSES);
export const landOwnershipTypeSchema = z.enum(LAND_OWNERSHIP_TYPES);
export const recommendationStatusSchema = z.enum(RECOMMENDATION_STATUSES);
export const decisionActionSchema = z.enum(DECISION_ACTIONS);
export const generatedBySchema = z.enum(GENERATED_BY_VALUES);
export const dataProvenanceSchema = z.enum(DATA_PROVENANCE_VALUES);
export const hazardEventSourceSchema = z.enum(HAZARD_EVENT_SOURCES);
export const eventConfidenceSchema = z.enum(EVENT_CONFIDENCE_LEVELS);
export const explanationDirectionSchema = z.enum(EXPLANATION_DIRECTIONS);
export const auditSeveritySchema = z.enum(AUDIT_SEVERITIES);
export const fieldReportObservationTypeSchema = z.enum(FIELD_REPORT_OBSERVATION_TYPES);
export const fieldReportVerificationStatusSchema = z.enum(FIELD_REPORT_VERIFICATION_STATUSES);
export const jobStatusSchema = z.enum(JOB_STATUSES);
export const jobTypeSchema = z.enum(JOB_TYPES);
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

const longitudeSchema = z.number().min(-180).max(180);
const latitudeSchema = z.number().min(-90).max(90);
const positionSchema = z.tuple([longitudeSchema, latitudeSchema]);

export const geoPointSchema = z.object({
  type: z.literal("Point"),
  coordinates: positionSchema,
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

const linearRingSchema = z.array(positionSchema).min(4);
const polygonCoordinatesSchema = z.array(linearRingSchema).min(1);

export const geoPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: polygonCoordinatesSchema,
});
export type GeoPolygon = z.infer<typeof geoPolygonSchema>;

export const geoMultiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(polygonCoordinatesSchema).min(1),
});
export type GeoMultiPolygon = z.infer<typeof geoMultiPolygonSchema>;

export const geoPolygonalSchema = z.union([geoPolygonSchema, geoMultiPolygonSchema]);
export type GeoPolygonal = z.infer<typeof geoPolygonalSchema>;

/** Step 10 Part 3B: a route's geometry — a LineString through H3 cell
 * centroids for the safest route, or a plain 2-point line for the direct
 * reference. */
export const geoLineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(positionSchema).min(2),
});
export type GeoLineString = z.infer<typeof geoLineStringSchema>;

/** Mandatory officer justification text — enforced repo-wide per CLAUDE.md. */
export const justificationSchema = z.string().trim().min(30, {
  message: "Justification must be at least 30 characters — officer actions are never silent.",
});

export const explanationEntrySchema = z.object({
  factor: z.string().min(1),
  contribution: z.number(),
  direction: explanationDirectionSchema,
  /** Plain-language rendering of `factor` (e.g. "slope" -> "Steepness of the terrain") for the officer workbench to render as a sentence, not a machine key. Optional for backward compatibility with GridCell's per-cell SHAP explanations (Step 4); always populated on Assessment.explanation (Step 5). */
  label: z.string().min(1).optional(),
});
export type ExplanationEntry = z.infer<typeof explanationEntrySchema>;

export const timestampsSchema = z.object({
  createdAt: z.date(),
  updatedAt: z.date(),
});
