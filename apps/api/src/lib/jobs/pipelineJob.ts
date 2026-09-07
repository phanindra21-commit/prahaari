import { Types } from "mongoose";
import type { HazardType } from "@prahari/shared";
import { District } from "../../models/District";
import { Job } from "../../models/Job";
import { audit } from "../audit";
import { slugify } from "../h3Grid";
import { scoreOneHazard, type HazardRunSummary, type ZoningJobActor } from "./zoningJob";
import { assessDistrictHabitations, type AssessmentStageSummary } from "./assessmentStage";
import { scoreDistrictSites, type SiteStageSummary } from "./siteStage";

export type PipelineJobActor = ZoningJobActor;

/**
 * The full pipeline: zones (one scoreOneHazard() per hazard, same as
 * runZoningJob), then habitation assessments (VI, coping capacity, risk,
 * RPI, priority buckets — assessDistrictHabitations()), then relocation-
 * site scoring and habitation-to-site matching (exclusions, AHP
 * suitability, carrying capacity, Recommendation generation —
 * scoreDistrictSites(), Step 7 Commit 2). Progress is reported per stage:
 * zoning advances progress toward ~55%, assessment to ~80%, sites to
 * 100%. GridCell/factor generation is a separate offline step
 * (generate-grid / derive_factors.py / ingest-factors — see
 * docs/ZONING_PIPELINE.md) run before this job, not part of the live
 * request/response cycle.
 *
 * Never throws: every failure is caught, written to the Job doc, and
 * audited — the caller (the route handler) fires this without awaiting it.
 */
export async function runPipelineJob(jobId: Types.ObjectId, actor: PipelineJobActor): Promise<void> {
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

    const zoningSummaries: HazardRunSummary[] = [];
    const ZONING_STAGE_SHARE = 0.55;
    const ASSESSMENT_STAGE_SHARE = 0.8;
    for (const hazardType of hazardTypes) {
      job.progressPercent = Math.round((zoningSummaries.length / hazardTypes.length) * ZONING_STAGE_SHARE * 100);
      await job.save();
      const summary = await scoreOneHazard(districtId, districtSlug, hazardType);
      zoningSummaries.push(summary);
    }

    job.progressPercent = Math.round(ZONING_STAGE_SHARE * 100);
    await job.save();

    const assessmentSummary: AssessmentStageSummary = await assessDistrictHabitations(districtId, hazardTypes);

    job.progressPercent = Math.round(ASSESSMENT_STAGE_SHARE * 100);
    await job.save();

    const siteSummary: SiteStageSummary = await scoreDistrictSites(districtId);

    job.status = "SUCCEEDED";
    job.progressPercent = 100;
    job.finishedAt = new Date();
    job.result = { zoning: zoningSummaries, assessment: assessmentSummary, sites: siteSummary };
    await job.save();

    await audit({
      actorId: actor.actorId,
      actorLabel: actor.actorLabel,
      action: "pipeline.run.completed",
      entityType: "job",
      entityId: jobId,
      before: null,
      after: {
        districtId: districtId.toString(),
        modelVersions: [
          ...zoningSummaries.map((s) => s.modelVersion),
          assessmentSummary.modelVersion,
          siteSummary.modelVersion,
        ],
        bucketCounts: assessmentSummary.bucketCounts,
        sitesExcluded: siteSummary.sitesExcluded.length,
        sitesScored: siteSummary.sitesScored,
        matchedHabitationCount: siteSummary.matchedHabitationCount,
        unmatchedHabitationCount: siteSummary.unmatchedHabitationCount,
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
      action: "pipeline.run.failed",
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
