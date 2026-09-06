import { z } from "zod";
import { objectIdSchema, notificationTypeSchema, timestampsSchema } from "./common";

/**
 * In-app notification (Step 10 Part 6): recipientId is always the current
 * user reading their own notifications (routes never accept an arbitrary
 * recipientId query — see fieldReport.routes.ts's ownership pattern this
 * follows), districtId is denormalized for scoping/filtering the same way
 * Decision/Recommendation already do it.
 */
export const notificationSchema = z
  .object({
    _id: objectIdSchema,
    recipientId: objectIdSchema,
    type: notificationTypeSchema,
    message: z.string().min(1),
    relatedEntityType: z.literal("recommendation"),
    relatedEntityId: objectIdSchema,
    districtId: objectIdSchema,
    read: z.boolean(),
  })
  .merge(timestampsSchema);
export type Notification = z.infer<typeof notificationSchema>;
