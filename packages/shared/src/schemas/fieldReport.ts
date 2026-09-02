import { z } from "zod";
import {
  objectIdSchema,
  geoPointSchema,
  fieldReportObservationTypeSchema,
  fieldReportVerificationStatusSchema,
  timestampsSchema,
} from "./common";

/** Lightweight ground-truth observation submitted by a FIELD_VOLUNTEER. */
export const fieldReportSchema = z
  .object({
    _id: objectIdSchema,
    habitationId: objectIdSchema,
    observationType: fieldReportObservationTypeSchema,
    photos: z.array(z.string().url()),
    notes: z.string().optional(),
    location: geoPointSchema,
    submittedBy: objectIdSchema,
    verificationStatus: fieldReportVerificationStatusSchema,
    verifiedBy: objectIdSchema.nullable(),
    verifiedAt: z.date().nullable(),
  })
  .merge(timestampsSchema);
export type FieldReport = z.infer<typeof fieldReportSchema>;

export const createFieldReportRequestSchema = fieldReportSchema.pick({
  habitationId: true,
  observationType: true,
  photos: true,
  notes: true,
  location: true,
});
export type CreateFieldReportRequest = z.infer<typeof createFieldReportRequestSchema>;
