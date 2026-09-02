import { z } from "zod";
import { objectIdSchema, timestampsSchema } from "./common";

/**
 * Never sent over the wire (tokenHash is a server-side secret) — this
 * schema documents the collection shape for consistency with every other
 * model, per CLAUDE.md's "every model gets a matching Zod schema" rule.
 */
export const refreshTokenSchema = z
  .object({
    _id: objectIdSchema,
    userId: objectIdSchema,
    tokenHash: z.string().min(1),
    family: objectIdSchema,
    expiresAt: z.date(),
    revokedAt: z.date().nullable(),
    replacedBy: objectIdSchema.nullable(),
    userAgent: z.string(),
    ipAddress: z.string(),
  })
  .merge(timestampsSchema);
export type RefreshToken = z.infer<typeof refreshTokenSchema>;
