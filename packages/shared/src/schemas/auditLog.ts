import { z } from "zod";
import { objectIdSchema, auditSeveritySchema, timestampsSchema } from "./common";

/**
 * Append-only, hash-chained audit trail entry. No update or delete is
 * ever issued against this collection — see the Mongoose model's mutation
 * guards and apps/api/src/lib/audit.ts (the only supported writer).
 */
export const auditLogSchema = z
  .object({
    _id: objectIdSchema,
    seq: z.number().int().nonnegative(),
    actorId: objectIdSchema.nullable(),
    actorLabel: z.string().min(1),
    action: z.string().min(1),
    entityType: z.string().min(1),
    entityId: objectIdSchema.nullable(),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    requestId: z.string().min(1),
    ipAddress: z.string().min(1),
    userAgent: z.string().min(1),
    severity: auditSeveritySchema,
    timestamp: z.date(),
    prevHash: z.string().min(1),
    entryHash: z.string().min(1),
  })
  .merge(timestampsSchema);
export type AuditLog = z.infer<typeof auditLogSchema>;
