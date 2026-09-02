/**
 * Placeholder domain types shared between apps/web and apps/api.
 * These will be expanded with full field sets in later build steps.
 */

export type HazardType = "landslide" | "flood" | "coastalErosion" | "cloudburst";

export type ZoneClass = "Red" | "Orange" | "Yellow" | "Green";

export type RelocationPriorityBucket = "Immediate" | "ShortTerm" | "MediumTerm";

export interface Habitation {
  id: string;
  name: string;
  district: string;
  state: string;
  population: number;
}

export interface HealthCheckResponse {
  status: "ok";
  service: string;
  timestamp: string;
}
