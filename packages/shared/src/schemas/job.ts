import { z } from "zod";
import { objectIdSchema, jobStatusSchema, jobTypeSchema, timestampsSchema } from "./common";

export const jobSchema = z
  .object({
    _id: objectIdSchema,
    type: jobTypeSchema,
    districtId: objectIdSchema,
    status: jobStatusSchema,
    progressPercent: z.number().min(0).max(100),
    params: z.record(z.string(), z.unknown()),
    result: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    createdBy: objectIdSchema,
    startedAt: z.date().nullable(),
    finishedAt: z.date().nullable(),
  })
  .merge(timestampsSchema);
export type Job = z.infer<typeof jobSchema>;
