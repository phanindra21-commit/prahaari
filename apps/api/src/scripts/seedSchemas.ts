/**
 * Zod schemas for the RAW seed files in data/seed/ — these mirror the
 * on-disk JSON/GeoJSON shape (which references other entities by natural
 * key, e.g. `districtLgdCode`, not by ObjectId) rather than the
 * database-ready shape in packages/shared/src/schemas. seed.ts parses
 * every file through these before touching MongoDB, then resolves natural
 * keys to ObjectIds itself.
 */
import { z } from "zod";
import {
  geoPointSchema,
  geoPolygonSchema,
  geoPolygonalSchema,
  hazardTypeSchema,
  zoneClassSchema,
  generatedBySchema,
  dataProvenanceSchema,
  landOwnershipTypeSchema,
  hazardEventSourceSchema,
  eventConfidenceSchema,
  userRoleSchema,
  consentStatusSchema,
  habitationDemographicsSchema,
  habitationStructuresSchema,
  habitationAccessSchema,
  habitationLivelihoodSchema,
  habitationCopingCapacitySchema,
  relocationSiteRawAttributesSchema,
} from "@punarvas/shared";

export const seedDistrictSchema = z.object({
  lgdCode: z.string().min(1),
  name: z.string().min(1),
  state: z.string().min(1),
  boundary: geoPolygonalSchema,
  population: z.number().int().nonnegative(),
  areaSqKm: z.number().positive(),
  primaryHazards: z.array(hazardTypeSchema).min(1),
  dmAuthorityContact: z.object({
    name: z.string().min(1),
    designation: z.string().min(1),
    phone: z.string().min(1),
    email: z.string().email().optional(),
  }),
});
export type SeedDistrict = z.infer<typeof seedDistrictSchema>;

export const seedHabitationFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: geoPointSchema,
  properties: z.object({
    lgdHabitationCode: z.string().min(1),
    name: z.string().min(1),
    block: z.string().min(1),
    panchayat: z.string().min(1),
    districtLgdCode: z.string().min(1),
    population: z.number().int().nonnegative(),
    households: z.number().int().nonnegative(),
    demographics: habitationDemographicsSchema,
    structures: habitationStructuresSchema,
    access: habitationAccessSchema,
    livelihood: habitationLivelihoodSchema,
    copingCapacity: habitationCopingCapacitySchema,
    consentStatus: consentStatusSchema,
    dataProvenance: dataProvenanceSchema,
  }),
});
export const seedHabitationCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(seedHabitationFeatureSchema),
});
export type SeedHabitationFeature = z.infer<typeof seedHabitationFeatureSchema>;

export const seedHazardZoneFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: geoPolygonalSchema,
  properties: z.object({
    districtLgdCode: z.string().min(1),
    hazardType: hazardTypeSchema,
    zoneClass: zoneClassSchema,
    hazardScore: z.number().min(0).max(1),
    factorContributions: z.record(z.string(), z.number()),
    modelVersion: z.string().min(1),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date().nullable(),
    generatedBy: generatedBySchema,
    supersedes: z.string().nullable(),
    dataProvenance: dataProvenanceSchema,
  }),
});
export const seedHazardZoneCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(seedHazardZoneFeatureSchema),
});
export type SeedHazardZoneFeature = z.infer<typeof seedHazardZoneFeatureSchema>;

export const seedHazardEventSchema = z.object({
  districtLgdCode: z.string().min(1),
  hazardType: hazardTypeSchema,
  name: z.string().min(1),
  date: z.coerce.date(),
  extent: z.union([geoPointSchema, geoPolygonalSchema]),
  deaths: z.number().int().nonnegative(),
  injured: z.number().int().nonnegative(),
  displaced: z.number().int().nonnegative(),
  housesDamaged: z.number().int().nonnegative(),
  economicLossInrLakh: z.number().nonnegative(),
  source: hazardEventSourceSchema,
  confidence: eventConfidenceSchema,
  dataProvenance: dataProvenanceSchema,
  sourceUrl: z.string().url().optional(),
});
export type SeedHazardEvent = z.infer<typeof seedHazardEventSchema>;

export const seedRelocationSiteFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: geoPolygonSchema,
  properties: z.object({
    districtLgdCode: z.string().min(1),
    name: z.string().min(1),
    centroid: geoPointSchema,
    areaSqm: z.number().positive(),
    landOwnership: landOwnershipTypeSchema,
    dataProvenance: dataProvenanceSchema,
    rawAttributes: relocationSiteRawAttributesSchema,
  }),
});
export const seedRelocationSiteCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(seedRelocationSiteFeatureSchema),
});
export type SeedRelocationSiteFeature = z.infer<typeof seedRelocationSiteFeatureSchema>;

export const seedUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: userRoleSchema,
  scope: z.object({
    state: z.string().optional(),
    districtLgdCode: z.string().optional(),
  }),
});
export type SeedUser = z.infer<typeof seedUserSchema>;
