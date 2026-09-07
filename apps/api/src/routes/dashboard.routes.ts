import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import type { HazardType, RelocationPriorityBucket } from "@prahari/shared";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { hasPermission } from "../lib/permissions";
import { buildScopeFilter } from "../lib/scope";
import { requireDistrictInScope } from "../lib/districtScope";
import { District } from "../models/District";
import { Assessment } from "../models/Assessment";
import { Recommendation } from "../models/Recommendation";
import { Decision } from "../models/Decision";
import { RelocationSite, type BindingConstraint } from "../models/RelocationSite";

export const dashboardRouter = Router();

const HABITATION_READ = "habitation:read";
const ASSESSMENT_READ = "assessment:read";
const RECOMMENDATION_READ = "recommendation:read";
const DECISION_READ = "decision:read";
const RELOCATION_SITE_READ = "relocationSite:read";

const MATCHABLE_BUCKETS: RelocationPriorityBucket[] = ["Immediate", "ShortTerm"];

interface CapacityShortfall {
  needsRelocation: number;
  hasViableSite: number;
  noViableSite: number;
  populationWithNoSite: number;
}

/**
 * Step 10 Part 1C: absolute counts (not normalized shares) for the
 * demographic cohorts facing relocation, summed across every
 * Immediate-priority habitation. Computed the same way as
 * HabitationReportPage.tsx's per-habitation counts — a habitation's
 * population/households times its recorded demographic share, rounded —
 * summed at habitation grain before rounding averages out most of the
 * per-habitation rounding error.
 */
interface ImmediateDemographics {
  under5: number;
  over60: number;
  disabled: number;
}

interface NeedsAttentionItem {
  habitationId: string;
  habitationName: string;
  relocationPriorityIndex: number;
  priorityBucket: RelocationPriorityBucket;
  governingHazard: HazardType;
  population: number;
  hasMatchedSite: boolean | null;
  recommendationId: string | null;
}

interface RecentDecisionItem {
  decisionId: string;
  action: string;
  officerName: string;
  justification: string;
  decidedAt: string;
  recommendationId: string;
}

interface DistrictDashboard {
  districtId: string;
  districtName: string;
  state: string;
  habitationsAssessed: number;
  redCount: number;
  orangeCount: number;
  bucketCounts: Record<RelocationPriorityBucket, number>;
  immediatePopulation: number;
  immediateHouseholds: number;
  immediateDemographics: ImmediateDemographics;
  pendingDecisions: number | null;
  capacityShortfall: CapacityShortfall | null;
  hazardDistribution: Array<{ hazardType: HazardType; count: number }> | null;
  bindingConstraintDistribution: Array<{ bindingConstraint: BindingConstraint; count: number }> | null;
  needsAttention: NeedsAttentionItem[] | null;
  recentDecisions: RecentDecisionItem[] | null;
}

function emptyBucketCounts(): Record<RelocationPriorityBucket, number> {
  return { Immediate: 0, ShortTerm: 0, MediumTerm: 0 };
}

/**
 * Computes one district's dashboard block. Every section beyond the
 * `habitation:read`-level figures is gated on the CALLER'S actual granted
 * permissions (Step 9 Part 1E) — never a flat "show everything" response
 * post-filtered client-side. A FIELD_VOLUNTEER (habitation:read only) gets
 * null for every section requiring assessment:read/recommendation:read/
 * decision:read/relocationSite:read; nothing sensitive is ever computed
 * for a role that can't see it, let alone sent over the wire.
 */
async function computeDistrictDashboard(
  district: { _id: Types.ObjectId; name: string; state: string },
  grants: { assessment: boolean; recommendation: boolean; decision: boolean; site: boolean },
): Promise<DistrictDashboard> {
  const districtId = district._id;

  const [habitationsAssessed, redCount, orangeCount, immediateAgg] = await Promise.all([
    Assessment.countDocuments({ districtId, validTo: null }),
    Assessment.countDocuments({ districtId, validTo: null, overallZoneClass: "Red" }),
    Assessment.countDocuments({ districtId, validTo: null, overallZoneClass: "Orange" }),
    Assessment.aggregate<{
      _id: null;
      population: number;
      households: number;
      under5: number;
      over60: number;
      disabled: number;
    }>([
      { $match: { districtId, validTo: null, priorityBucket: "Immediate" } },
      { $lookup: { from: "habitations", localField: "habitationId", foreignField: "_id", as: "h" } },
      { $unwind: "$h" },
      {
        $project: {
          population: "$h.population",
          households: "$h.households",
          under5: { $round: [{ $multiply: ["$h.population", "$h.demographics.shareUnder5"] }, 0] },
          over60: { $round: [{ $multiply: ["$h.population", "$h.demographics.shareOver60"] }, 0] },
          disabled: { $round: [{ $multiply: ["$h.population", "$h.demographics.disabledPersonsShare"] }, 0] },
        },
      },
      {
        $group: {
          _id: null,
          population: { $sum: "$population" },
          households: { $sum: "$households" },
          under5: { $sum: "$under5" },
          over60: { $sum: "$over60" },
          disabled: { $sum: "$disabled" },
        },
      },
    ]),
  ]);

  const bucketCounts = emptyBucketCounts();
  const bucketAgg = await Assessment.aggregate<{ _id: RelocationPriorityBucket; count: number }>([
    { $match: { districtId, validTo: null, priorityBucket: { $ne: null } } },
    { $group: { _id: "$priorityBucket", count: { $sum: 1 } } },
  ]);
  for (const row of bucketAgg) {
    bucketCounts[row._id] = row.count;
  }

  const base: DistrictDashboard = {
    districtId: districtId.toString(),
    districtName: district.name,
    state: district.state,
    habitationsAssessed,
    redCount,
    orangeCount,
    bucketCounts,
    immediatePopulation: immediateAgg[0]?.population ?? 0,
    immediateHouseholds: immediateAgg[0]?.households ?? 0,
    immediateDemographics: {
      under5: immediateAgg[0]?.under5 ?? 0,
      over60: immediateAgg[0]?.over60 ?? 0,
      disabled: immediateAgg[0]?.disabled ?? 0,
    },
    pendingDecisions: null,
    capacityShortfall: null,
    hazardDistribution: null,
    bindingConstraintDistribution: null,
    needsAttention: null,
    recentDecisions: null,
  };

  if (grants.assessment) {
    const hazardAgg = await Assessment.aggregate<{ _id: HazardType; count: number }>([
      { $match: { districtId, validTo: null } },
      { $group: { _id: "$governingHazard", count: { $sum: 1 } } },
    ]);
    base.hazardDistribution = hazardAgg.map((row) => ({ hazardType: row._id, count: row.count }));

    const topAssessments = await Assessment.find({ districtId, validTo: null, priorityBucket: { $ne: null } })
      .sort({ relocationPriorityIndex: -1 })
      .limit(10)
      .populate<{ habitationId: { _id: Types.ObjectId; name: string; population: number } }>(
        "habitationId",
        "name population",
      );

    let recommendationByHabitation = new Map<string, { id: string; hasMatchedSite: boolean }>();
    if (grants.recommendation) {
      const recs = await Recommendation.find({
        districtId,
        habitationId: { $in: topAssessments.map((a) => a.habitationId) },
      });
      recommendationByHabitation = new Map(
        recs.map((r) => [
          r.habitationId.toString(),
          { id: (r._id as Types.ObjectId).toString(), hasMatchedSite: r.phasing.length > 0 },
        ]),
      );
    }

    base.needsAttention = topAssessments
      .filter((a) => a.relocationPriorityIndex !== null && a.priorityBucket !== null)
      .map((a) => {
        const habitation = a.habitationId as unknown as { _id: Types.ObjectId; name: string; population: number };
        const rec = recommendationByHabitation.get(habitation._id.toString());
        return {
          habitationId: habitation._id.toString(),
          habitationName: habitation.name,
          relocationPriorityIndex: a.relocationPriorityIndex as number,
          priorityBucket: a.priorityBucket as RelocationPriorityBucket,
          governingHazard: a.governingHazard,
          population: habitation.population,
          hasMatchedSite: grants.recommendation ? (rec?.hasMatchedSite ?? false) : null,
          recommendationId: rec?.id ?? null,
        };
      });
  }

  if (grants.recommendation) {
    const [pendingDecisions, eligibleAssessments, recommendations] = await Promise.all([
      Recommendation.countDocuments({ districtId, status: "PENDING_REVIEW" }),
      Assessment.countDocuments({
        districtId,
        validTo: null,
        priorityBucket: { $in: MATCHABLE_BUCKETS },
      }),
      Recommendation.find({ districtId }).populate<{
        habitationId: { _id: Types.ObjectId; population: number };
      }>("habitationId", "population"),
    ]);
    base.pendingDecisions = pendingDecisions;

    const matched = recommendations.filter((r) => r.phasing.length > 0);
    const unmatched = recommendations.filter((r) => r.phasing.length === 0);
    const noSiteCount = Math.max(0, eligibleAssessments - matched.length);
    const populationWithNoSite = unmatched.reduce((sum, r) => {
      const habitation = r.habitationId as unknown as { _id: Types.ObjectId; population: number } | null;
      return sum + (habitation?.population ?? 0);
    }, 0);
    base.capacityShortfall = {
      needsRelocation: eligibleAssessments,
      hasViableSite: matched.length,
      noViableSite: noSiteCount,
      populationWithNoSite,
    };
  }

  if (grants.decision) {
    const decisions = await Decision.find({ districtId })
      .sort({ decidedAt: -1 })
      .limit(10)
      .populate<{ officerId: { name: string } }>("officerId", "name");
    base.recentDecisions = decisions.map((d) => {
      const officer = d.officerId as unknown as { name: string } | null;
      return {
        decisionId: (d._id as Types.ObjectId).toString(),
        action: d.action,
        officerName: officer?.name ?? "Unknown officer",
        justification: d.justification,
        decidedAt: d.decidedAt.toISOString(),
        recommendationId: d.recommendationId.toString(),
      };
    });
  }

  if (grants.site) {
    const sites = await RelocationSite.find({ districtId, carryingCapacity: { $ne: null } });
    const counts = new Map<BindingConstraint, number>();
    for (const site of sites) {
      const constraint = site.carryingCapacity?.bindingConstraint;
      if (!constraint) continue;
      counts.set(constraint, (counts.get(constraint) ?? 0) + 1);
    }
    base.bindingConstraintDistribution = Array.from(counts.entries()).map(([bindingConstraint, count]) => ({
      bindingConstraint,
      count,
    }));
  }

  return base;
}

function sumDashboards(blocks: DistrictDashboard[]): Omit<DistrictDashboard, "districtId" | "districtName" | "state"> {
  const bucketCounts = emptyBucketCounts();
  const hazardMap = new Map<HazardType, number>();
  const constraintMap = new Map<BindingConstraint, number>();
  let habitationsAssessed = 0;
  let redCount = 0;
  let orangeCount = 0;
  let immediatePopulation = 0;
  let immediateHouseholds = 0;
  const immediateDemographics: ImmediateDemographics = { under5: 0, over60: 0, disabled: 0 };
  let pendingDecisions = 0;
  let hasPendingDecisions = false;
  let shortfall: CapacityShortfall | null = null;
  let hasShortfall = false;
  let hasHazard = false;
  let hasConstraint = false;

  for (const block of blocks) {
    habitationsAssessed += block.habitationsAssessed;
    redCount += block.redCount;
    orangeCount += block.orangeCount;
    immediatePopulation += block.immediatePopulation;
    immediateHouseholds += block.immediateHouseholds;
    immediateDemographics.under5 += block.immediateDemographics.under5;
    immediateDemographics.over60 += block.immediateDemographics.over60;
    immediateDemographics.disabled += block.immediateDemographics.disabled;
    for (const bucket of Object.keys(bucketCounts) as RelocationPriorityBucket[]) {
      bucketCounts[bucket] += block.bucketCounts[bucket];
    }
    if (block.pendingDecisions !== null) {
      hasPendingDecisions = true;
      pendingDecisions += block.pendingDecisions;
    }
    if (block.capacityShortfall) {
      hasShortfall = true;
      shortfall ??= { needsRelocation: 0, hasViableSite: 0, noViableSite: 0, populationWithNoSite: 0 };
      shortfall.needsRelocation += block.capacityShortfall.needsRelocation;
      shortfall.hasViableSite += block.capacityShortfall.hasViableSite;
      shortfall.noViableSite += block.capacityShortfall.noViableSite;
      shortfall.populationWithNoSite += block.capacityShortfall.populationWithNoSite;
    }
    if (block.hazardDistribution) {
      hasHazard = true;
      for (const entry of block.hazardDistribution) {
        hazardMap.set(entry.hazardType, (hazardMap.get(entry.hazardType) ?? 0) + entry.count);
      }
    }
    if (block.bindingConstraintDistribution) {
      hasConstraint = true;
      for (const entry of block.bindingConstraintDistribution) {
        constraintMap.set(entry.bindingConstraint, (constraintMap.get(entry.bindingConstraint) ?? 0) + entry.count);
      }
    }
  }

  return {
    habitationsAssessed,
    redCount,
    orangeCount,
    bucketCounts,
    immediatePopulation,
    immediateHouseholds,
    immediateDemographics,
    pendingDecisions: hasPendingDecisions ? pendingDecisions : null,
    capacityShortfall: hasShortfall ? shortfall : null,
    hazardDistribution: hasHazard
      ? Array.from(hazardMap.entries()).map(([hazardType, count]) => ({ hazardType, count }))
      : null,
    bindingConstraintDistribution: hasConstraint
      ? Array.from(constraintMap.entries()).map(([bindingConstraint, count]) => ({ bindingConstraint, count }))
      : null,
    // A cross-district "needs attention"/"recent decisions" list would need
    // a second cross-district sort+limit pass; left per-district only (the
    // web UI renders it per selected district) rather than a half-correct
    // merge-and-truncate here.
    needsAttention: null,
    recentDecisions: null,
  };
}

const querySchema = z.object({
  districtId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
});

/**
 * GET /api/v1/dashboard/summary — Step 9 Part 1: the officer's landing
 * page. Scoped to the caller's district(s) by `requireScope()` (a
 * DISTRICT_OFFICER/ANALYST/FIELD_VOLUNTEER always has exactly one
 * district in scope; STATE_ADMIN/SUPER_ADMIN may have several, in which
 * case the response includes a per-district breakdown plus a summed
 * `aggregate` block). Gated on `habitation:read` (the broadest read
 * permission every role holds, including FIELD_VOLUNTEER) — richer
 * sections are populated only for a caller whose role actually holds the
 * matching permission, never blanket-computed and trimmed client-side.
 */
dashboardRouter.get(
  "/dashboard/summary",
  authenticate,
  requirePermission(HABITATION_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = querySchema.parse(req.query);
      const role = req.auth!.role;

      // District documents are keyed by their own `_id`, not a
      // `districtId` field — `req.scopeFilter` (built by the
      // `requireScope()` call above with the DEFAULT field name, for this
      // route's other districtId-keyed queries below) would silently
      // mismatch every District document for any non-SUPER_ADMIN role.
      // Re-derive scope with the District collection's own identity
      // field, same as district.routes.ts's `GET /districts`.
      let districts;
      if (query.districtId) {
        const districtId = new Types.ObjectId(query.districtId);
        const district = await requireDistrictInScope({ role, ...req.auth!.scope }, districtId);
        if (!district) {
          res.status(404).json({ error: "District not found or out of scope" });
          return;
        }
        districts = [district];
      } else {
        const districtScopeFilter = await buildScopeFilter({ role, ...req.auth!.scope }, { districtField: "_id" });
        districts = await District.find(districtScopeFilter).sort({ name: 1 });
      }

      if (districts.length === 0) {
        res.status(200).json({ districts: [], aggregate: null });
        return;
      }

      const grants = {
        assessment: hasPermission(role, ASSESSMENT_READ),
        recommendation: hasPermission(role, RECOMMENDATION_READ),
        decision: hasPermission(role, DECISION_READ),
        site: hasPermission(role, RELOCATION_SITE_READ),
      };

      const blocks = await Promise.all(
        districts.map((d) => computeDistrictDashboard({ _id: d._id as Types.ObjectId, name: d.name, state: d.state }, grants)),
      );

      res.status(200).json({
        districts: blocks,
        aggregate: blocks.length > 1 ? sumDashboards(blocks) : null,
      });
    })().catch(next);
  },
);
