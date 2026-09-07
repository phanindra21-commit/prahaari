import { z } from "zod";

const boolFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  COOKIE_SECURE: boolFromString,
  COOKIE_DOMAIN: z.string().optional(),

  SEED_DEFAULT_PASSWORD: z.string().min(8).default("PRAHARI@DevDefault123"),

  ML_SERVICE_URL: z.string().url().default("http://localhost:8000"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`[env] Invalid environment configuration: ${result.error.toString()}`);
  }
  return result.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const cookieSecure = isProduction || env.COOKIE_SECURE;

export const corsAllowedOrigins: string[] = env.CORS_ALLOWED_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
