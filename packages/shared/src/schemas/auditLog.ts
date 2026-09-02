import { z } from "zod";
import { objectIdSchema, timestampsSchema } from "./common";

/** Append-only. No update or delete is ever issued against this collection — see Mongoose model. */
export const auditLogSchema = z
  .object({
    _id: objectIdSchema,
    actorId: objectIdSchema,
    action: z.string().min(1),
    entityType: z.string().min(1),
    entityId: objectIdSchema,
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    timestamp: z.date(),
    ipAddress: z.string().min(1),
    userAgent: z.string().min(1),
  })
  .merge(timestampsSchema);
export type AuditLog = z.infer<typeof auditLogSchema>;
