import { z } from "zod";
import { objectIdSchema, hazardTypeSchema, timestampsSchema } from "./common";

export const modelMetricsSchema = z.object({
  aucRoc: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  recall: z.number().min(0).max(1),
  f1: z.number().min(0).max(1),
  calibrationError: z.number().min(0),
});
export type ModelMetrics = z.infer<typeof modelMetricsSchema>;

/** labelSource is always "SYNTHETIC_DEMO" for models trained in this build — see services/ml/app/engine/labels.py. */
export const modelRunSchema = z
  .object({
    _id: objectIdSchema,
    modelVersion: z.string().min(1),
    hazardType: hazardTypeSchema,
    algorithm: z.string().min(1),
    trainedAt: z.date(),
    featureList: z.array(z.string().min(1)).min(1),
    hyperparameters: z.record(z.string(), z.unknown()),
    metrics: modelMetricsSchema,
    trainingSampleCount: z.number().int().min(1),
    labelSource: z.string().min(1),
    notes: z.string().optional(),
  })
  .merge(timestampsSchema);
export type ModelRun = z.infer<typeof modelRunSchema>;
