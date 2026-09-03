import { z } from "zod";
import { explanationEntrySchema, geoPolygonalSchema, hazardTypeSchema, zoneClassSchema } from "@punarvas/shared";
import type { HazardType } from "@punarvas/shared";
import { env } from "./env";

const cellScoreSchema = z.object({
  h3Index: z.string().min(1),
  district: z.string().min(1),
  overlayScore: z.number().min(0).max(1),
  mlScore: z.number().min(0).max(1),
  blendedScore: z.number().min(0).max(1),
  zoneClass: zoneClassSchema,
  topFactors: z.array(explanationEntrySchema),
});
export type MlCellScore = z.infer<typeof cellScoreSchema>;

const zonePolygonSchema = z.object({
  district: z.string().min(1),
  zoneClass: zoneClassSchema,
  cellCount: z.number().int().positive(),
  geometry: geoPolygonalSchema,
  simplifiedGeometry: geoPolygonalSchema,
});
export type MlZonePolygon = z.infer<typeof zonePolygonSchema>;

const modelMetricsSchema = z.object({
  aucRoc: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  recall: z.number().min(0).max(1),
  f1: z.number().min(0).max(1),
  calibrationError: z.number().min(0),
});

const zoningRunResponseSchema = z.object({
  hazardType: hazardTypeSchema,
  cellScores: z.array(cellScoreSchema),
  zones: z.array(zonePolygonSchema),
  metrics: modelMetricsSchema,
  featureList: z.array(z.string().min(1)),
  trainingSampleCount: z.number().int().positive(),
  labelSource: z.string().min(1),
});
export type ZoningRunResponse = z.infer<typeof zoningRunResponseSchema>;

export interface ZoningRunCellInput {
  h3Index: string;
  district: string;
  lon: number;
  lat: number;
  factors: Record<string, number>;
}

export interface MlServiceClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
}

/** An HTTP-layer failure from the ML service — distinguishes a definite 4xx
 * (bad request on our side, never worth retrying) from a 5xx/network/timeout
 * failure (transient, worth retrying). */
export class MlServiceHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MlServiceHttpError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Typed HTTP client to services/ml. Every response is Zod-validated before
 * being handed to a caller — the ML service's response shape is never
 * trusted blindly, per CLAUDE.md's "validate at every API boundary" rule
 * (this is the api -> ml boundary).
 */
export class MlServiceClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;

  constructor(options: MlServiceClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? env.ML_SERVICE_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.initialBackoffMs = options.initialBackoffMs ?? 500;
  }

  async runZoning(
    hazardType: HazardType,
    cells: ZoningRunCellInput[],
    eventPoints: [number, number][] = [],
  ): Promise<ZoningRunResponse> {
    const raw = await this.postWithRetry(
      "/zoning/run",
      JSON.stringify({ hazardType, cells, eventPoints }),
    );
    const parsed = zoningRunResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `[mlServiceClient] POST /zoning/run response failed validation: ${parsed.error.toString()}`,
      );
    }
    return parsed.data;
  }

  private async postWithRetry(path: string, body: string): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.postOnce(path, body);
      } catch (error) {
        lastError = error;
        const retryable = !(error instanceof MlServiceHttpError) || error.status >= 500;
        if (!retryable || attempt === this.maxRetries) {
          break;
        }
        await sleep(this.initialBackoffMs * 2 ** attempt);
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`[mlServiceClient] ${path} failed: ${message}`);
  }

  private async postOnce(path: string, body: string): Promise<unknown> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new MlServiceHttpError(response.status, `HTTP ${response.status}: ${text}`);
      }
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export const mlServiceClient = new MlServiceClient();
