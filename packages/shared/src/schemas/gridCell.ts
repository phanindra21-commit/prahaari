import { z } from "zod";
import {
  objectIdSchema,
  geoPointSchema,
  geoPolygonalSchema,
  hazardTypeSchema,
  zoneClassSchema,
  dataProvenanceSchema,
  explanationEntrySchema,
  timestampsSchema,
} from "./common";

export const hazardScoreEntrySchema = z.object({
  overlayScore: z.number().min(0).max(1),
  mlScore: z.number().min(0).max(1),
  blendedScore: z.number().min(0).max(1),
  zoneClass: zoneClassSchema,
});
export type HazardScoreEntry = z.infer<typeof hazardScoreEntrySchema>;

/** hazardType -> factorName -> raw value. Keyed per-hazard (not flattened) because the same factor name can mean different things across hazards (e.g. landCover is a forest-cover index for landslide, an imperviousness index for flood). */
export const gridCellFactorsSchema = z.record(hazardTypeSchema, z.record(z.string(), z.number()));
export type GridCellFactors = z.infer<typeof gridCellFactorsSchema>;

export const gridCellHazardScoresSchema = z.record(hazardTypeSchema, hazardScoreEntrySchema);
export type GridCellHazardScores = z.infer<typeof gridCellHazardScoresSchema>;

/** hazardType -> top-N signed SHAP factor contributions for that cell's most recent zoning run (services/ml/app/engine/explain.py). */
export const gridCellExplanationsSchema = z.record(hazardTypeSchema, z.array(explanationEntrySchema));
export type GridCellExplanations = z.infer<typeof gridCellExplanationsSchema>;

export const gridCellSchema = z
  .object({
    _id: objectIdSchema,
    h3Index: z.string().min(1),
    resolution: z.number().int().min(0).max(15),
    districtId: objectIdSchema,
    centroid: geoPointSchema,
    boundary: geoPolygonalSchema,
    factors: gridCellFactorsSchema,
    hazardScores: gridCellHazardScoresSchema,
    explanations: gridCellExplanationsSchema.optional(),
    modelVersion: z.string().min(1),
    computedAt: z.date(),
    dataProvenance: dataProvenanceSchema,
  })
  .merge(timestampsSchema);
export type GridCell = z.infer<typeof gridCellSchema>;
