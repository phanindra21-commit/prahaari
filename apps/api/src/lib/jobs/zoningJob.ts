import { Types } from "mongoose";
import type { HazardType } from "@punarvas/shared";
import { District } from "../../models/District";
import { GridCell } from "../../models/GridCell";
import { HazardEvent } from "../../models/HazardEvent";
import { ModelRun } from "../../models/ModelRun";
import { Job } from "../../models/Job";
import { mlServiceClient, type ZoningRunCellInput } from "../mlServiceClient";
import { writeZoneVersion, type ZoneVersionInput } from "../zoneVersioning";
import { audit } from "../audit";
import { slugify } from "../h3Grid";

export interface ZoningJobActor {
  actorId: Types.ObjectId;
  actorLabel: string;
  requestId: string;
  ipAddress: string;
  userAgent: string;
}

interface HazardRunSummary {
  hazardType: HazardType;
  modelVersion: string;
  cellCount: number;
  zoneCounts: Record<string, number>;
  metrics: { aucRoc: number; precision: number; recall: number; f1: number; calibrationError: number };
}

/** These are services/ml/app/engine/train.py's hardcoded XGBoost hyperparameters —
 * not returned by the /zoning/run response, so recorded here for the ModelRun
 * doc's provenance rather than left blank. Keep in sync if train.py changes them. */
const TRAIN_HYPERPARAMETERS = {
  maxDepth: 4,
  nEstimators: 200,
  learningRate: 0.1,
  subsample: 0.8,
  colsampleByTree: 0.8,
};

async function scoreOneHazard(
  districtId: Types.ObjectId,
  districtSlug: string,
  hazardType: HazardType,
): Promise<HazardRunSummary> {
  const factorField = `factors.${hazardType}`;
  const cells = await GridCell.find({ districtId, [factorField]: { $exists: true } });
  if (cells.length === 0) {
    throw new Error(
      `No GridCell documents have factors.${hazardType} for this district — run generate-grid, ` +
        "derive_factors.py, then ingest-factors first.",
    );
  }

  const cellInputs: ZoningRunCellInput[] = cells.map((cell) => ({
    h3Index: cell.h3Index,
    district: districtSlug,
    lon: cell.centroid.coordinates[0],
    lat: cell.centroid.coordinates[1],
    factors: cell.factors[hazardType] as Record<string, number>,
  }));

  const events = await HazardEvent.find({ districtId, hazardType, "extent.type": "Point" });
  const eventPoints: [number, number][] = events.map((event) => {
    const [lon, lat] = (event.extent as { coordinates: [number, number] }).coordinates;
    return [lon, lat];
  });

  const response = await mlServiceClient.runZoning(hazardType, cellInputs, eventPoints);
  const modelVersion = `${hazardType}-overlay-ml-v1-${Date.now()}`;
  const computedAt = new Date();

  const gridCellUpdates = response.cellScores.map((score) => ({
    updateOne: {
      filter: { h3Index: score.h3Index },
      update: {
        $set: {
          [`hazardScores.${hazardType}`]: {
            overlayScore: score.overlayScore,
            mlScore: score.mlScore,
            blendedScore: score.blendedScore,
            zoneClass: score.zoneClass,
          },
          [`explanations.${hazardType}`]: score.topFactors,
          modelVersion,
          computedAt,
        },
      },
    },
  }));
  await GridCell.bulkWrite(gridCellUpdates);

  await ModelRun.create({
    modelVersion,
    hazardType,
    algorithm: "xgboost-binary-classifier",
    trainedAt: computedAt,
    featureList: response.featureList,
    hyperparameters: TRAIN_HYPERPARAMETERS,
    metrics: response.metrics,
    trainingSampleCount: response.trainingSampleCount,
    labelSource: response.labelSource,
    notes:
      "SYNTHETIC_DEMO training labels (services/ml/app/engine/labels.py) — not a real historical " +
      "hazard inventory. See docs/ZONING_PIPELINE.md.",
  });

  const meanBlendedByClass = new Map<string, { sum: number; count: number }>();
  for (const score of response.cellScores) {
    const bucket = meanBlendedByClass.get(score.zoneClass) ?? { sum: 0, count: 0 };
    bucket.sum += score.blendedScore;
    bucket.count += 1;
    meanBlendedByClass.set(score.zoneClass, bucket);
  }

  const districtZones = response.zones.filter((zone) => zone.district === districtSlug);
  const zoneInputs: ZoneVersionInput[] = districtZones.map((zone) => {
    const bucket = meanBlendedByClass.get(zone.zoneClass);
    return {
      zoneClass: zone.zoneClass,
      geometry: zone.geometry,
      simplifiedGeometry: zone.simplifiedGeometry,
      hazardScore: bucket ? bucket.sum / bucket.count : 0,
      factorContributions: {},
      modelVersion,
      generatedBy: "MODEL",
      dataProvenance: "SYNTHETIC_DEMO",
    };
  });
  await writeZoneVersion(districtId, hazardType, zoneInputs, computedAt);

  const zoneCounts: Record<string, number> = {};
  for (const zone of districtZones) {
    zoneCounts[zone.zoneClass] = zone.cellCount;
  }

  return {
    hazardType,
    modelVersion,
    cellCount: cells.length,
    zoneCounts,
    metrics: response.metrics,
  };
}

/**
 * Runs a full zoning job in-process (no queue — see CLAUDE.md's Step 4
 * roadmap entry: "In-process job runner"). Never throws: every failure is
 * caught, written to the Job doc, and audited — the caller (the route
 * handler) fires this without awaiting it and must not need a try/catch.
 */
export async function runZoningJob(jobId: Types.ObjectId, actor: ZoningJobActor): Promise<void> {
  const job = await Job.findById(jobId);
  if (!job) {
    return;
  }

  const startedAt = new Date();
  job.status = "RUNNING";
  job.startedAt = startedAt;
  await job.save();

  const districtId = job.districtId;
  const hazardTypes = job.params.hazardTypes as HazardType[];

  try {
    const district = await District.findById(districtId);
    if (!district) {
      throw new Error(`District ${districtId.toString()} no longer exists`);
    }
    const districtSlug = slugify(district.name);

    const summaries: HazardRunSummary[] = [];
    for (const hazardType of hazardTypes) {
      job.progressPercent = Math.round((summaries.length / hazardTypes.length) * 100);
      await job.save();
      const summary = await scoreOneHazard(districtId, districtSlug, hazardType);
      summaries.push(summary);
    }

    job.status = "SUCCEEDED";
    job.progressPercent = 100;
    job.finishedAt = new Date();
    job.result = { summaries };
    await job.save();

    await audit({
      actorId: actor.actorId,
      actorLabel: actor.actorLabel,
      action: "zoning.run.completed",
      entityType: "job",
      entityId: jobId,
      before: null,
      after: {
        districtId: districtId.toString(),
        modelVersions: summaries.map((s) => s.modelVersion),
        zoneCounts: Object.fromEntries(summaries.map((s) => [s.hazardType, s.zoneCounts])),
      },
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      severity: "INFO",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.status = "FAILED";
    job.finishedAt = new Date();
    job.error = message;
    await job.save();

    await audit({
      actorId: actor.actorId,
      actorLabel: actor.actorLabel,
      action: "zoning.run.failed",
      entityType: "job",
      entityId: jobId,
      before: null,
      after: { districtId: districtId.toString(), hazardTypes, error: message },
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      severity: "WARNING",
    });
  }
}
