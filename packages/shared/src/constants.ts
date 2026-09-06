/**
 * Shared constant arrays. Kept in sync by hand with the corresponding
 * literal union types in ./types.ts (this mirrors an established pattern
 * in this codebase: types.ts holds the type-level union, constants.ts
 * holds the runtime array for iteration / Zod enum construction).
 */

export const HAZARD_TYPES = ["landslide", "flood", "coastalErosion", "cloudburst"] as const;

export const ZONE_CLASSES = ["Red", "Orange", "Yellow", "Green"] as const;

export const PRIORITY_BUCKETS = ["Immediate", "ShortTerm", "MediumTerm"] as const;

export const USER_ROLES = [
  "SUPER_ADMIN",
  "STATE_ADMIN",
  "DISTRICT_OFFICER",
  "ANALYST",
  "FIELD_VOLUNTEER",
] as const;

export const CONSENT_STATUSES = ["NOT_ENGAGED", "CONSULTED", "CONSENTED", "OBJECTED"] as const;

export const LAND_OWNERSHIP_TYPES = ["GOVT", "PRIVATE", "COMMUNITY", "FOREST"] as const;

export const RECOMMENDATION_STATUSES = [
  "PENDING_REVIEW",
  "APPROVED",
  "MODIFIED",
  "REJECTED",
  "DEFERRED",
] as const;

export const DECISION_ACTIONS = ["APPROVE", "MODIFY", "REJECT", "DEFER"] as const;

export const GENERATED_BY_VALUES = ["MODEL", "OFFICER_OVERRIDE"] as const;

export const DATA_PROVENANCE_VALUES = ["SYNTHETIC_DEMO", "PUBLIC_RECORD"] as const;

export const HAZARD_EVENT_SOURCES = ["GSI", "IMD", "SDMA", "NEWS"] as const;

export const EVENT_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;

export const EXPLANATION_DIRECTIONS = ["INCREASES_RISK", "DECREASES_RISK"] as const;

export const AUDIT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;

export const FIELD_REPORT_OBSERVATION_TYPES = [
  "STRUCTURAL_DAMAGE",
  "GROUND_CRACK",
  "WATER_LOGGING",
  "EROSION",
  "LANDSLIDE_ACTIVITY",
  "INFRASTRUCTURE_DAMAGE",
  "OTHER",
] as const;

export const FIELD_REPORT_VERIFICATION_STATUSES = ["PENDING", "VERIFIED", "REJECTED"] as const;

export const JOB_STATUSES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"] as const;

export const JOB_TYPES = ["ZONING_RUN", "PIPELINE_RUN"] as const;

export const PILOT_DISTRICTS = [
  { name: "Wayanad", state: "Kerala", primaryHazard: "landslide" },
  { name: "Ganjam", state: "Odisha", primaryHazard: "coastalErosion" },
  { name: "Chamoli", state: "Uttarakhand", primaryHazard: "landslide" },
] as const;
