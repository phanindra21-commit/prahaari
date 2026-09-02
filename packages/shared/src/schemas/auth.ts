import { z } from "zod";
import { objectIdSchema, userRoleSchema } from "./common";

/** The user shape returned over the wire — never includes passwordHash. */
export const safeUserSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  email: z.string().email(),
  role: userRoleSchema,
  scope: z.object({
    state: z.string().optional(),
    districtId: objectIdSchema.optional(),
  }),
  isActive: z.boolean(),
  lastLoginAt: z.date().nullable(),
});
export type SafeUser = z.infer<typeof safeUserSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.date(),
  user: safeUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.date(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const meResponseSchema = z.object({
  user: safeUserSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const logoutResponseSchema = z.object({
  loggedOut: z.literal(true),
});
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
