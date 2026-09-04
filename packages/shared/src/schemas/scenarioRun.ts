import { z } from "zod";
import {
  objectIdSchema,
  hazardTypeSchema,
  zoneClassSchema,
  priorityBucketSchema,
  geoPolygonalSchema,
  timestampsSchema,
} from "./common";

export const scenarioParametersSchema = z
  .object({
    rainfallMmPer24h: z.number().positive().optional(),
    seaLevelRiseM: z.number().positive().optional(),
    cycloneCategory: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  })
  .refine(
    (p) => p.rainfallMmPer24h !== undefined || p.seaLevelRiseM !== undefined || p.cycloneCategory !== undefined,
    { message: "At least one scenario parameter must be set" },
  );
export type ScenarioParameters = z.infer<typeof scenarioParametersSchema>;

const zoneCountsSchema = z.object({
  Red: z.number().int().nonnegative(),
  Orange: z.number().int().nonnegative(),
  Yellow: z.number().int().nonnegative(),
  Green: z.number().int().nonnegative(),
});

export const hazardCellSummarySchema = z.object({
  hazardType: hazardTypeSchema,
  affected: z.boolean(),
  baselineZoneCounts: zoneCountsSchema,
  scenarioZoneCounts: zoneCountsSchema,
  cellsChanged: z.number().int().nonnegative(),
  newlyRedCells: z.number().int().nonnegative(),
});
export type HazardCellSummary = z.infer<typeof hazardCellSummarySchema>;

export const cellClassTransitionSchema = z.object({
  hazardType: hazardTypeSchema,
  fromZoneClass: zoneClassSchema,
  toZoneClass: zoneClassSchema,
  cellCount: z.number().int().positive(),
});
export type CellClassTransition = z.infer<typeof cellClassTransitionSchema>;

export const habitationDeltaSchema = z.object({
  habitationId: objectIdSchema,
  habitationName: z.string().min(1),
  baselineOverallZoneClass: zoneClassSchema,
  scenarioOverallZoneClass: zoneClassSchema,
  baselinePriorityBucket: priorityBucketSchema.nullable(),
  scenarioPriorityBucket: priorityBucketSchema.nullable(),
  enteredImmediate: z.boolean(),
  zoneClassWorsened: z.boolean(),
});
export type HabitationDelta = z.infer<typeof habitationDeltaSchema>;

export const hazardZoneGeometrySchema = z.object({
  hazardType: hazardTypeSchema,
  baseline: z.record(z.string(), geoPolygonalSchema),
  scenario: z.record(z.string(), geoPolygonalSchema),
  changed: geoPolygonalSchema.nullable(),
});
export type HazardZoneGeometry = z.infer<typeof hazardZoneGeometrySchema>;

/** A saved what-if scenario (Step 8 Part 2) — results stored here only;
 * the district's active zoning/assessment is never touched by a run.
 * Only created on success (a mid-run failure returns an HTTP error and
 * persists nothing — there is no partial result worth reloading). */
export const scenarioRunSchema = z
  .object({
    _id: objectIdSchema,
    name: z.string().min(1),
    districtId: objectIdSchema,
    hazardTypes: z.array(hazardTypeSchema),
    parameters: scenarioParametersSchema,
    hazardSummaries: z.array(hazardCellSummarySchema),
    cellTransitions: z.array(cellClassTransitionSchema),
    habitationDeltas: z.array(habitationDeltaSchema),
    habitationsEnteringImmediate: z.array(z.string()),
    zoneGeometries: z.array(hazardZoneGeometrySchema),
    runtimeSeconds: z.number().nonnegative(),
    modelVersion: z.string().min(1),
    createdBy: objectIdSchema,
  })
  .merge(timestampsSchema);
export type ScenarioRun = z.infer<typeof scenarioRunSchema>;
