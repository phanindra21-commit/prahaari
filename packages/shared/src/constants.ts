/**
 * Placeholder shared constants. Values here are illustrative only and
 * will be superseded by the weighted tables in docs/METHODOLOGY.md.
 */

export const HAZARD_TYPES = ["landslide", "flood", "coastalErosion", "cloudburst"] as const;

export const ZONE_CLASSES = ["Red", "Orange", "Yellow", "Green"] as const;

export const PILOT_DISTRICTS = [
  { name: "Wayanad", state: "Kerala", primaryHazard: "landslide" },
  { name: "Ganjam", state: "Odisha", primaryHazard: "coastalErosion" },
] as const;
