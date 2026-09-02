import { z } from "zod";
import {
  objectIdSchema,
  hazardTypeSchema,
  geoPointSchema,
  geoPolygonalSchema,
  hazardEventSourceSchema,
  eventConfidenceSchema,
  dataProvenanceSchema,
  timestampsSchema,
} from "./common";

export const hazardEventSchema = z
  .object({
    _id: objectIdSchema,
    districtId: objectIdSchema,
    hazardType: hazardTypeSchema,
    name: z.string().min(1),
    date: z.date(),
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
  })
  .merge(timestampsSchema);
export type HazardEvent = z.infer<typeof hazardEventSchema>;
