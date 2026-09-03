/**
 * Lightweight domain enums shared between apps/web and apps/api.
 * Full document shapes (with all fields) live in ./schemas as Zod schemas
 * + their inferred types — these are just the small standalone unions
 * referenced from multiple schemas.
 */

export type HazardType = "landslide" | "flood" | "coastalErosion" | "cloudburst";

export type ZoneClass = "Red" | "Orange" | "Yellow" | "Green";

export type RelocationPriorityBucket = "Immediate" | "ShortTerm" | "MediumTerm";

export type UserRole =
  "SUPER_ADMIN" | "STATE_ADMIN" | "DISTRICT_OFFICER" | "ANALYST" | "FIELD_VOLUNTEER";

export type ConsentStatus = "NOT_ENGAGED" | "CONSULTED" | "CONSENTED" | "OBJECTED";

export type LandOwnershipType = "GOVT" | "PRIVATE" | "COMMUNITY" | "FOREST";

export type RecommendationStatus =
  "PENDING_REVIEW" | "APPROVED" | "MODIFIED" | "REJECTED" | "DEFERRED";

export type DecisionAction = "APPROVE" | "MODIFY" | "REJECT" | "DEFER";

export type GeneratedBy = "MODEL" | "OFFICER_OVERRIDE";

export type DataProvenance = "SYNTHETIC_DEMO" | "PUBLIC_RECORD";

export type HazardEventSource = "GSI" | "IMD" | "SDMA" | "NEWS";

export type EventConfidence = "HIGH" | "MEDIUM" | "LOW";

export type ExplanationDirection = "INCREASES_RISK" | "DECREASES_RISK";

export type AuditSeverity = "INFO" | "WARNING" | "CRITICAL";

export type FieldReportObservationType =
  | "STRUCTURAL_DAMAGE"
  | "GROUND_CRACK"
  | "WATER_LOGGING"
  | "EROSION"
  | "LANDSLIDE_ACTIVITY"
  | "INFRASTRUCTURE_DAMAGE"
  | "OTHER";

export type FieldReportVerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";

export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
export type JobType = "ZONING_RUN";

export interface HealthCheckResponse {
  status: "ok";
  service: string;
  timestamp: string;
}
