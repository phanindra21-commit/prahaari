import { z } from "zod";
import {
  objectIdSchema,
  geoPointSchema,
  geoPolygonSchema,
  consentStatusSchema,
  dataProvenanceSchema,
  timestampsSchema,
} from "./common";

export const habitationDemographicsSchema = z.object({
  shareUnder5: z.number().min(0).max(1),
  shareOver60: z.number().min(0).max(1),
  womenHeadedHouseholdShare: z.number().min(0).max(1),
  disabledPersonsShare: z.number().min(0).max(1),
  bplShare: z.number().min(0).max(1),
  scStShare: z.number().min(0).max(1),
  literacyRate: z.number().min(0).max(1),
});
export type HabitationDemographics = z.infer<typeof habitationDemographicsSchema>;

export const foundationTypeSchema = z.enum(["NONE", "RUBBLE", "STONE_MASONRY", "RCC"]);

export const habitationStructuresSchema = z.object({
  kutchaHousingShare: z.number().min(0).max(1),
  avgBuildingAgeYears: z.number().nonnegative(),
  predominantFoundationType: foundationTypeSchema,
});
export type HabitationStructures = z.infer<typeof habitationStructuresSchema>;

export const habitationAccessSchema = z.object({
  distanceToAllWeatherRoadKm: z.number().nonnegative(),
  distanceToPhcKm: z.number().nonnegative(),
  mobileNetworkCoverage: z.number().min(0).max(1),
  evacuationRouteCount: z.number().int().nonnegative(),
});
export type HabitationAccess = z.infer<typeof habitationAccessSchema>;

export const primaryOccupationSchema = z.enum([
  "AGRICULTURE",
  "PLANTATION",
  "FISHERIES",
  "DAILY_WAGE_LABOUR",
  "TRADE",
  "GOVERNMENT_SERVICE",
  "OTHER",
]);

export const habitationLivelihoodSchema = z.object({
  primaryOccupation: primaryOccupationSchema,
  distanceToLivelihoodAssetKm: z.number().nonnegative(),
  primaryLivelihoodDependenceShare: z.number().min(0).max(1),
});
export type HabitationLivelihood = z.infer<typeof habitationLivelihoodSchema>;

/** Raw inputs for METHODOLOGY §2.2's CopingCapacity index — see packages/shared/src/config/vulnerability-weights.json's copingCapacity block and indicator-normalization.json for how each becomes a 0-1 indicator. */
export const habitationCopingCapacitySchema = z.object({
  sdrfResponseTimeMinutes: z.number().positive(),
  shelterWithin2km: z.boolean(),
  communityTaskForcePresent: z.boolean(),
  earlyWarningCoverage: z.number().min(0).max(1),
});
export type HabitationCopingCapacity = z.infer<typeof habitationCopingCapacitySchema>;

export const habitationSchema = z
  .object({
    _id: objectIdSchema,
    lgdHabitationCode: z.string().min(1),
    name: z.string().min(1),
    block: z.string().min(1),
    panchayat: z.string().min(1),
    districtId: objectIdSchema,
    centroid: geoPointSchema,
    boundary: geoPolygonSchema.optional(),
    population: z.number().int().nonnegative(),
    households: z.number().int().nonnegative(),
    demographics: habitationDemographicsSchema,
    structures: habitationStructuresSchema,
    access: habitationAccessSchema,
    livelihood: habitationLivelihoodSchema,
    copingCapacity: habitationCopingCapacitySchema,
    consentStatus: consentStatusSchema,
    dataProvenance: dataProvenanceSchema,
    sourceUrl: z.string().url().optional(),
  })
  .merge(timestampsSchema);
export type Habitation = z.infer<typeof habitationSchema>;
