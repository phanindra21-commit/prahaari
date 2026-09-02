import { z } from "zod";
import { objectIdSchema, hazardTypeSchema, zoneClassSchema, timestampsSchema } from "./common";

export const scenarioParametersSchema = z.object({
  rainfallMmPer24h: z.number().nonnegative().optional(),
  seaLevelRiseM: z.number().nonnegative().optional(),
  cycloneCategory: z.number().int().min(1).max(5).optional(),
});
export type ScenarioParameters = z.infer<typeof scenarioParametersSchema>;

export const affectedZoneDeltaSchema = z.object({
  hazardZoneId: objectIdSchema,
  hazardType: hazardTypeSchema,
  previousZoneClass: zoneClassSchema,
  projectedZoneClass: zoneClassSchema,
  scoreDelta: z.number(),
});
export type AffectedZoneDelta = z.infer<typeof affectedZoneDeltaSchema>;

/** A saved what-if scenario (e.g. +20% rainfall, +0.5m sea level rise). */
export const scenarioRunSchema = z
  .object({
    _id: objectIdSchema,
    name: z.string().min(1),
    parameters: scenarioParametersSchema,
    affectedZoneDeltas: z.array(affectedZoneDeltaSchema),
    createdBy: objectIdSchema,
  })
  .merge(timestampsSchema);
export type ScenarioRun = z.infer<typeof scenarioRunSchema>;
