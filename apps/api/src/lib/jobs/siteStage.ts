import { Types } from "mongoose";
import { capacityNorms } from "@punarvas/shared";
import type { RelocationPriorityBucket } from "@punarvas/shared";
import { District } from "../../models/District";
import { Habitation, type HabitationDoc } from "../../models/Habitation";
import { RelocationSite } from "../../models/RelocationSite";
import { Assessment } from "../../models/Assessment";
import { Recommendation } from "../../models/Recommendation";
import { getActiveZones } from "../zoneVersioning";
import {
  mlServiceClient,
  type SiteScoringRunSiteInput,
  type SiteScoringRunHabitationInput,
} from "../mlServiceClient";

const PHASE_1_LEAD_TIME_DAYS = 90;
const MATCHABLE_BUCKETS: RelocationPriorityBucket[] = ["Immediate", "ShortTerm"];

export interface ExcludedSiteSummary {
  siteId: string;
  name: string;
  failedCriteria: string[];
}

export interface SiteStageSummary {
  /** True when the stage did nothing because this district has no
   * RelocationSite documents yet — a legitimate state (site data not
   * yet entered for this district), not an error, unlike zero
   * habitations in assessmentStage.ts which IS treated as an error. */
  skipped: boolean;
  siteCount: number;
  sitesExcluded: ExcludedSiteSummary[];
  sitesScored: number;
  eligibleHabitationCount: number;
  matchedHabitationCount: number;
  unmatchedHabitationCount: number;
  recommendationsGenerated: number;
  modelVersion: string | null;
}

/**
 * Scores every RelocationSite in a district (exclusions -> AHP
 * suitability -> carrying capacity, services/ml's /sites/run), persists
 * the result back onto each RelocationSite doc (mutated in place, same
 * "PENDING_SCORE then computed" convention as GridCell — never
 * versioned, per RelocationSite's own docstring), matches every
 * Immediate/ShortTerm habitation to its ranked candidate sites, and
 * writes one Recommendation per matched habitation (METHODOLOGY §4/§5,
 * Step 7 Commit 2).
 *
 * Only this district's PENDING_REVIEW recommendations are cleared before
 * regenerating — a recommendation an officer has already decided on
 * (APPROVED/MODIFIED/REJECTED/DEFERRED) is never touched by a pipeline
 * re-run.
 */
export async function scoreDistrictSites(districtId: Types.ObjectId): Promise<SiteStageSummary> {
  const district = await District.findById(districtId);
  if (!district) {
    throw new Error(`District ${districtId.toString()} no longer exists`);
  }

  const sites = await RelocationSite.find({ districtId });
  if (sites.length === 0) {
    return {
      skipped: true,
      siteCount: 0,
      sitesExcluded: [],
      sitesScored: 0,
      eligibleHabitationCount: 0,
      matchedHabitationCount: 0,
      unmatchedHabitationCount: 0,
      recommendationsGenerated: 0,
      modelVersion: null,
    };
  }

  const terrainTier = capacityNorms.stateTerrainTier[district.state];
  if (!terrainTier) {
    throw new Error(
      `No terrainTier configured for state "${district.state}" in capacity-norms.json's stateTerrainTier`,
    );
  }

  const activeZones = await getActiveZones({ districtId });
  const redOrangeZoneGeometries = activeZones
    .filter((zone) => zone.zoneClass === "Red" || zone.zoneClass === "Orange")
    .map((zone) => zone.geometry);

  const siteInputs: SiteScoringRunSiteInput[] = sites.map((site) => ({
    siteId: (site._id as Types.ObjectId).toString(),
    geometry: site.geometry,
    lon: site.centroid.coordinates[0],
    lat: site.centroid.coordinates[1],
    areaSqm: site.areaSqm,
    landOwnership: site.landOwnership,
    rawAttributes: site.rawAttributes,
  }));

  const eligibleAssessments = await Assessment.find({
    districtId,
    validTo: null,
    priorityBucket: { $in: MATCHABLE_BUCKETS },
  });
  const eligibleHabitationIds = eligibleAssessments.map((a) => a.habitationId);
  const eligibleHabitations = await Habitation.find({ _id: { $in: eligibleHabitationIds } });
  const habitationById = new Map<string, HabitationDoc>(
    eligibleHabitations.map((h) => [(h._id as Types.ObjectId).toString(), h]),
  );
  const assessmentByHabitationId = new Map(eligibleAssessments.map((a) => [a.habitationId.toString(), a]));

  const habitationInputs: SiteScoringRunHabitationInput[] = eligibleAssessments
    .map((assessment): SiteScoringRunHabitationInput | null => {
      const habitation = habitationById.get(assessment.habitationId.toString());
      if (!habitation || !assessment.priorityBucket || assessment.relocationPriorityIndex === null) {
        return null;
      }
      return {
        habitationId: (habitation._id as Types.ObjectId).toString(),
        lon: habitation.centroid.coordinates[0],
        lat: habitation.centroid.coordinates[1],
        distanceToLivelihoodAssetKm: habitation.livelihood.distanceToLivelihoodAssetKm,
        households: habitation.households,
        priorityBucket: assessment.priorityBucket,
        relocationPriorityIndex: assessment.relocationPriorityIndex,
      };
    })
    .filter((input): input is SiteScoringRunHabitationInput => input !== null);

  const response = await mlServiceClient.runSiteScoring(
    district.state,
    terrainTier,
    redOrangeZoneGeometries,
    siteInputs,
    habitationInputs,
  );

  const modelVersion = `sites-v1-${Date.now()}`;
  const scoredAt = new Date();
  const siteById = new Map(sites.map((s) => [(s._id as Types.ObjectId).toString(), s]));

  const sitesExcluded: ExcludedSiteSummary[] = [];
  let sitesScored = 0;

  for (const siteResult of response.sites) {
    const site = siteById.get(siteResult.siteId);
    if (!site) {
      continue;
    }
    site.exclusionsPassed = siteResult.exclusions.passed;
    site.exclusionsFailed = siteResult.exclusions.failed;
    site.suitabilitySubScores = new Map(Object.entries(siteResult.suitabilitySubScores ?? {}));
    site.overallSuitabilityScore = siteResult.overallSuitabilityScore;
    site.carryingCapacity = siteResult.carryingCapacity;
    site.scoredAt = scoredAt;
    site.modelVersion = modelVersion;
    await site.save();

    if (siteResult.exclusions.excluded) {
      sitesExcluded.push({
        siteId: siteResult.siteId,
        name: site.name,
        failedCriteria: siteResult.exclusions.failed,
      });
    } else {
      sitesScored += 1;
    }
  }

  await Recommendation.deleteMany({ districtId, status: "PENDING_REVIEW" });

  let matchedHabitationCount = 0;
  let unmatchedHabitationCount = 0;
  let recommendationsGenerated = 0;
  const phase1TargetDate = new Date(scoredAt.getTime() + PHASE_1_LEAD_TIME_DAYS * 24 * 60 * 60 * 1000);

  for (const match of response.matches) {
    const habitation = habitationById.get(match.habitationId);
    const assessment = assessmentByHabitationId.get(match.habitationId);
    if (!habitation || !assessment || !assessment.priorityBucket) {
      continue;
    }
    const topRankedSite = match.rankedSites[0];
    if (!topRankedSite) {
      unmatchedHabitationCount += 1;
      continue;
    }

    const topSite = siteById.get(topRankedSite.siteId);
    const rationale =
      match.allocatedSiteId !== null
        ? `${habitation.name} (${assessment.priorityBucket} priority, ${habitation.households} households) ` +
          `is recommended for relocation to ${topSite?.name ?? topRankedSite.siteId}, the highest-ranked ` +
          `candidate site with sufficient remaining carrying capacity.`
        : `${habitation.name} (${assessment.priorityBucket} priority, ${habitation.households} households) has ` +
          `${match.rankedSites.length} ranked candidate site(s), but none currently has enough remaining ` +
          `carrying capacity for all its households — phased relocation across multiple sites or additional ` +
          `site development would be needed before this habitation can be fully matched.`;

    if (match.allocatedSiteId !== null) {
      matchedHabitationCount += 1;
    } else {
      unmatchedHabitationCount += 1;
    }

    await Recommendation.create({
      habitationId: habitation._id,
      districtId,
      candidateSites: match.rankedSites.map((r) => ({
        relocationSiteId: new Types.ObjectId(r.siteId),
        rank: r.rank,
        suitabilityScore: r.suitabilityScore,
      })),
      priorityBucket: assessment.priorityBucket,
      estimatedHouseholdsToMove: habitation.households,
      phasing:
        match.allocatedHouseholds > 0
          ? [{ phase: 1, householdCount: match.allocatedHouseholds, targetDate: phase1TargetDate }]
          : [],
      rationale,
      modelVersion,
      status: "PENDING_REVIEW",
      generatedAt: scoredAt,
    });
    recommendationsGenerated += 1;
  }

  return {
    skipped: false,
    siteCount: sites.length,
    sitesExcluded,
    sitesScored,
    eligibleHabitationCount: habitationInputs.length,
    matchedHabitationCount,
    unmatchedHabitationCount,
    recommendationsGenerated,
    modelVersion,
  };
}
