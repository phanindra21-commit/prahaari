import { z } from "zod";
import { objectIdSchema, userRoleSchema, timestampsSchema } from "./common";

export const userScopeSchema = z.object({
  state: z.string().min(1).optional(),
  districtId: objectIdSchema.optional(),
});
export type UserScope = z.infer<typeof userScopeSchema>;

export const userSchema = z
  .object({
    _id: objectIdSchema,
    name: z.string().min(1),
    email: z.string().email(),
    passwordHash: z.string().min(1),
    role: userRoleSchema,
    scope: userScopeSchema,
    isActive: z.boolean(),
    lastLoginAt: z.date().nullable(),
  })
  .merge(timestampsSchema);
export type User = z.infer<typeof userSchema>;

export const createUserInputSchema = userSchema
  .omit({ _id: true, createdAt: true, updatedAt: true, lastLoginAt: true, passwordHash: true })
  .extend({
    password: z.string().min(8),
  });
export type CreateUserInput = z.infer<typeof createUserInputSchema>;
