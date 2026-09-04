import { z } from "zod";
import {
  objectIdSchema,
  decisionActionSchema,
  justificationSchema,
  timestampsSchema,
} from "./common";

export const overriddenFieldSchema = z.object({
  field: z.string().min(1),
  fromValue: z.unknown(),
  toValue: z.unknown(),
});
export type OverriddenField = z.infer<typeof overriddenFieldSchema>;

/** The human-in-the-loop record: an officer's approval or override of a Recommendation. */
export const decisionSchema = z
  .object({
    _id: objectIdSchema,
    recommendationId: objectIdSchema,
    districtId: objectIdSchema,
    officerId: objectIdSchema,
    action: decisionActionSchema,
    justification: justificationSchema,
    overriddenFields: z.array(overriddenFieldSchema),
    decidedAt: z.date(),
    ipAddress: z.string().min(1),
  })
  .merge(timestampsSchema);
export type Decision = z.infer<typeof decisionSchema>;
