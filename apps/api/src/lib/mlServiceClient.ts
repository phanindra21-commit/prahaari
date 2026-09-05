import { z } from "zod";
import {
  explanationEntrySchema,
  geoPolygonalSchema,
  geoLineStringSchema,
  hazardTypeSchema,
  zoneClassSchema,
  priorityBucketSchema,
  bindingConstraintSchema,
} from "@punarvas/shared";
import type {
  HazardType,
  GeoPolygonal,
  ZoneClass,
  LandOwnershipType,
  TerrainTier,
  RelocationSiteRawAttributes,
  RelocationPriorityBucket,
  ScenarioParameters,
} from "@punarvas/shared";
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

const vulnerabilityDimensionsSchema = z.object({
  demographic: z.number().min(0).max(1),
  socioeconomic: z.number().min(0).max(1),
  structural: z.number().min(0).max(1),
  accessibility: z.number().min(0).max(1),
});

const hazardExposureOutSchema = z.object({
  hazardType: hazardTypeSchema,
  hazardScore: z.number().min(0).max(1),
  exposure: z.number().min(0).max(1),
  zoneClass: zoneClassSchema,
  disasterHistoryBoost: z.number().min(0).max(1).default(0),
});

const compoundHazardOutSchema = z.object({
  trigger: hazardTypeSchema,
  mechanism: hazardTypeSchema,
  triggerRisk: z.number().min(0).max(1),
  mechanismRisk: z.number().min(0).max(1),
  compoundRisk: z.number().min(0).max(1),
});

const assessmentOutSchema = z.object({
  habitationId: z.string().min(1),
  hazardExposure: z.array(hazardExposureOutSchema).min(1),
  vulnerabilityIndex: z.number().min(0).max(1),
  vulnerabilityDimensions: vulnerabilityDimensionsSchema,
  copingCapacity: z.number().min(0).max(1),
  compositeRiskScore: z.number().min(0).max(1),
  governingHazard: hazardTypeSchema,
  overallZoneClass: zoneClassSchema,
  relocationPriorityIndex: z.number().min(0).max(1).nullable(),
  priorityBucket: priorityBucketSchema.nullable(),
  explanation: z.array(explanationEntrySchema),
  compoundHazard: compoundHazardOutSchema.nullable().default(null),
});
export type MlAssessment = z.infer<typeof assessmentOutSchema>;

const assessmentRunResponseSchema = z.object({
  assessments: z.array(assessmentOutSchema),
});
export type AssessmentRunResponse = z.infer<typeof assessmentRunResponseSchema>;

export interface AssessmentRunZoneEntry {
  zoneClass: ZoneClass;
  geometry: GeoPolygonal;
  hazardScore: number;
}

export interface AssessmentRunHabitationInput {
  habitationId: string;
  lon: number;
  lat: number;
  households: number;
  demographics: Record<string, number>;
  structures: Record<string, unknown>;
  access: Record<string, unknown>;
  livelihood: Record<string, unknown>;
  copingCapacity: Record<string, unknown>;
}

export interface AssessmentRunHazardEventInput {
  hazardType: HazardType;
  lon: number;
  lat: number;
  date: string;
}

const exclusionsOutSchema = z.object({
  passed: z.array(z.string()),
  failed: z.array(z.string()),
  excluded: z.boolean(),
});

const capacityOutSchema = z.object({
  byLand: z.number().nonnegative(),
  byWater: z.number().nonnegative(),
  byEducation: z.number().nonnegative(),
  byHealth: z.number().nonnegative(),
  byAccess: z.number().nonnegative(),
  effectiveCapacity: z.number().nonnegative(),
  bindingConstraint: bindingConstraintSchema,
});

const siteOutSchema = z.object({
  siteId: z.string().min(1),
  exclusions: exclusionsOutSchema,
  suitabilitySubScores: z.record(z.string(), z.number()).nullable(),
  overallSuitabilityScore: z.number().min(0).max(1).nullable(),
  carryingCapacity: capacityOutSchema.nullable(),
});
export type MlSiteScoringResult = z.infer<typeof siteOutSchema>;

/** Step 10 Part 3B: a route's per-zone-class distance/share breakdown. */
const routeExposureOutSchema = z.object({
  zoneClass: zoneClassSchema,
  km: z.number().nonnegative(),
  percent: z.number().min(0).max(100),
});

const routeOutSchema = z.object({
  routeGeometry: geoLineStringSchema,
  directGeometry: geoLineStringSchema,
  routeLengthKm: z.number().nonnegative(),
  directLengthKm: z.number().nonnegative(),
  detourRatio: z.number().nonnegative(),
  routeExposure: z.array(routeExposureOutSchema),
  directExposure: z.array(routeExposureOutSchema),
});
export type MlRoute = z.infer<typeof routeOutSchema>;

const rankedSiteOutSchema = z.object({
  siteId: z.string().min(1),
  rank: z.number().int().positive(),
  suitabilityScore: z.number().min(0).max(1),
  subScores: z.record(z.string(), z.number()),
  route: routeOutSchema.nullable(),
  routeSafetyScore: z.number().min(0).max(1).nullable(),
});

const matchOutSchema = z.object({
  habitationId: z.string().min(1),
  rankedSites: z.array(rankedSiteOutSchema),
  allocatedSiteId: z.string().nullable(),
  allocatedHouseholds: z.number().int().nonnegative(),
});
export type MlSiteMatch = z.infer<typeof matchOutSchema>;

const siteScoringRunResponseSchema = z.object({
  sites: z.array(siteOutSchema),
  matches: z.array(matchOutSchema),
});
export type SiteScoringRunResponse = z.infer<typeof siteScoringRunResponseSchema>;

export interface SiteScoringRunSiteInput {
  siteId: string;
  geometry: GeoPolygonal;
  lon: number;
  lat: number;
  areaSqm: number;
  landOwnership: LandOwnershipType;
  rawAttributes: RelocationSiteRawAttributes;
}

export interface SiteScoringRunHabitationInput {
  habitationId: string;
  lon: number;
  lat: number;
  distanceToLivelihoodAssetKm: number;
  households: number;
  priorityBucket: RelocationPriorityBucket;
  relocationPriorityIndex: number;
}

/** Step 10 Part 3A/3B: one H3 cell's GOVERNING hazard zone class/score
 * (whichever of the district's hazards has the highest blendedScore at
 * that cell) — the slim shape siteStage.ts sends for route computation,
 * derived from the district's full GridCell documents. */
export interface SiteScoringRunGridCellInput {
  h3Index: string;
  lon: number;
  lat: number;
  zoneClass: ZoneClass;
  score: number;
}

const zoneCountsOutSchema = z.object({
  Red: z.number().int().nonnegative(),
  Orange: z.number().int().nonnegative(),
  Yellow: z.number().int().nonnegative(),
  Green: z.number().int().nonnegative(),
});

const hazardCellSummaryOutSchema = z.object({
  hazard: hazardTypeSchema,
  affected: z.boolean(),
  baselineZoneCounts: zoneCountsOutSchema,
  scenarioZoneCounts: zoneCountsOutSchema,
  cellsChanged: z.number().int().nonnegative(),
  newlyRedCells: z.number().int().nonnegative(),
});

const cellClassTransitionOutSchema = z.object({
  hazard: hazardTypeSchema,
  fromClass: zoneClassSchema,
  toClass: zoneClassSchema,
  cellCount: z.number().int().positive(),
});

const habitationDeltaOutSchema = z.object({
  habitationId: z.string().min(1),
  baselineOverallZoneClass: zoneClassSchema,
  scenarioOverallZoneClass: zoneClassSchema,
  baselinePriorityBucket: priorityBucketSchema.nullable(),
  scenarioPriorityBucket: priorityBucketSchema.nullable(),
  enteredImmediate: z.boolean(),
  zoneClassWorsened: z.boolean(),
});

const hazardZoneGeometryOutSchema = z.object({
  hazard: hazardTypeSchema,
  baseline: z.record(z.string(), geoPolygonalSchema),
  scenario: z.record(z.string(), geoPolygonalSchema),
  changed: geoPolygonalSchema.nullable(),
});

const scenarioRunResponseSchema = z.object({
  hazardSummaries: z.array(hazardCellSummaryOutSchema),
  cellTransitions: z.array(cellClassTransitionOutSchema),
  habitationDeltas: z.array(habitationDeltaOutSchema),
  habitationsEnteringImmediate: z.array(z.string()),
  zoneGeometries: z.array(hazardZoneGeometryOutSchema),
  runtimeSeconds: z.number().nonnegative(),
});
export type ScenarioRunMlResponse = z.infer<typeof scenarioRunResponseSchema>;

export interface ScenarioRunCellInput {
  h3Index: string;
  district: string;
  lon: number;
  lat: number;
  factors: Record<string, number>;
}

export interface ScenarioRunHabitationInput {
  habitationId: string;
  lon: number;
  lat: number;
  households: number;
  demographics: Record<string, number>;
  structures: Record<string, unknown>;
  access: Record<string, unknown>;
  livelihood: Record<string, unknown>;
  copingCapacity: Record<string, unknown>;
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

  async runAssessment(
    hazardZones: Partial<Record<HazardType, AssessmentRunZoneEntry[]>>,
    habitations: AssessmentRunHabitationInput[],
    hazardEvents: AssessmentRunHazardEventInput[] = [],
  ): Promise<AssessmentRunResponse> {
    const raw = await this.postWithRetry(
      "/assessment/run",
      JSON.stringify({ hazardZones, habitations, hazardEvents }),
    );
    const parsed = assessmentRunResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `[mlServiceClient] POST /assessment/run response failed validation: ${parsed.error.toString()}`,
      );
    }
    return parsed.data;
  }

  async runSiteScoring(
    state: string,
    terrainTier: TerrainTier,
    redOrangeZoneGeometries: GeoPolygonal[],
    sites: SiteScoringRunSiteInput[],
    habitations: SiteScoringRunHabitationInput[],
    gridCells: SiteScoringRunGridCellInput[] = [],
  ): Promise<SiteScoringRunResponse> {
    const raw = await this.postWithRetry(
      "/sites/run",
      JSON.stringify({
        state,
        terrainTier,
        redOrangeZoneGeometries,
        sites,
        habitations,
        gridCells,
      }),
    );
    const parsed = siteScoringRunResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `[mlServiceClient] POST /sites/run response failed validation: ${parsed.error.toString()}`,
      );
    }
    return parsed.data;
  }

  /**
   * Step 8 Part 2D — POST /scenarios/run. `timeoutMs` defaults to this
   * client's normal 30s, which already has headroom over the measured
   * true runtime (Wayanad ~3.9s, Ganjam's larger grid ~4.8-6.8s
   * depending on how many hazards the parameters affect — see
   * docs/METHODOLOGY.md's scenario-simulator section for the full
   * measurement). Not retried on failure by the caller — a scenario run
   * is a synchronous, user-initiated action; retrying it silently could
   * double-run an expensive computation for the same request.
   */
  async runScenario(
    hazardCells: Partial<Record<HazardType, ScenarioRunCellInput[]>>,
    hazardEventPoints: Partial<Record<HazardType, [number, number][]>>,
    habitations: ScenarioRunHabitationInput[],
    hazardEvents: AssessmentRunHazardEventInput[],
    parameters: ScenarioParameters,
  ): Promise<ScenarioRunMlResponse> {
    const raw = await this.postWithRetry(
      "/scenarios/run",
      JSON.stringify({ hazardCells, hazardEventPoints, habitations, hazardEvents, parameters }),
    );
    const parsed = scenarioRunResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `[mlServiceClient] POST /scenarios/run response failed validation: ${parsed.error.toString()}`,
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
