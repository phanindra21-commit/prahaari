import { z } from "zod";
import {
  objectIdSchema,
  geoPolygonalSchema,
  hazardTypeSchema,
  zoneClassSchema,
  generatedBySchema,
  dataProvenanceSchema,
  timestampsSchema,
} from "./common";

/**
 * HazardZone documents are VERSIONED, never mutated: a new zoning run
 * inserts new documents and sets `supersedes` to the previous version's
 * _id rather than updating it in place, preserving a full history of how
 * zoning has changed over time.
 */
export const hazardZoneSchema = z
  .object({
    _id: objectIdSchema,
    districtId: objectIdSchema,
    hazardType: hazardTypeSchema,
    geometry: geoPolygonalSchema,
    simplifiedGeometry: geoPolygonalSchema.optional(),
    zoneClass: zoneClassSchema,
    hazardScore: z.number().min(0).max(1),
    factorContributions: z.record(z.string(), z.number()),
    modelVersion: z.string().min(1),
    validFrom: z.date(),
    validTo: z.date().nullable(),
    generatedBy: generatedBySchema,
    supersedes: objectIdSchema.nullable(),
    dataProvenance: dataProvenanceSchema,
    sourceUrl: z.string().url().optional(),
  })
  .merge(timestampsSchema);
export type HazardZone = z.infer<typeof hazardZoneSchema>;
