import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import {
  zoneClassSchema,
  priorityBucketSchema,
  hazardExposureEntrySchema,
  vulnerabilityDimensionScoresSchema,
  explanationEntrySchema,
  geoPointSchema,
} from "@punarvas/shared";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { requireDistrictInScope } from "../lib/districtScope";
import { Habitation, type HabitationDoc } from "../models/Habitation";
import { Assessment, type AssessmentDoc } from "../models/Assessment";
import { getActiveAssessment } from "../lib/assessmentVersioning";

export const habitationRouter = Router();

const HABITATION_READ = "habitation:read";
const ASSESSMENT_READ = "assessment:read";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const LIST_PAGE_SIZE_CAP = 200;

/** Compact assessment summary attached to each habitation in a list/GeoJSON response. */
const assessmentSummarySchema = z.object({
  overallZoneClass: zoneClassSchema,
  compositeRiskScore: z.number().min(0).max(1),
  vulnerabilityIndex: z.number().min(0).max(1),
  relocationPriorityIndex: z.number().min(0).max(1).nullable(),
  priorityBucket: priorityBucketSchema.nullable(),
  computedAt: z.date(),
});
type AssessmentSummary = z.infer<typeof assessmentSummarySchema>;

/** The full assessment record returned by the detail/assessment/explain endpoints. */
const assessmentDetailSchema = z.object({
  id: objectIdString,
  habitationId: objectIdString,
  districtId: objectIdString,
  hazardExposure: z.array(hazardExposureEntrySchema),
  vulnerabilityIndex: z.number().min(0).max(1),
  vulnerabilityDimensions: vulnerabilityDimensionScoresSchema,
  copingCapacity: z.number().min(0).max(1),
  compositeRiskScore: z.number().min(0).max(1),
  governingHazard: z.string(),
  overallZoneClass: zoneClassSchema,
  relocationPriorityIndex: z.number().min(0).max(1).nullable(),
  priorityBucket: priorityBucketSchema.nullable(),
  modelVersion: z.string(),
  computedAt: z.date(),
  validFrom: z.date(),
  validTo: z.date().nullable(),
  explanation: z.array(explanationEntrySchema),
});
type AssessmentDetail = z.infer<typeof assessmentDetailSchema>;

const habitationSummarySchema = z.object({
  id: objectIdString,
  lgdHabitationCode: z.string(),
  name: z.string(),
  block: z.string(),
  panchayat: z.string(),
  districtId: objectIdString,
  centroid: geoPointSchema,
  population: z.number(),
  households: z.number(),
  consentStatus: z.string(),
  assessment: assessmentSummarySchema.nullable(),
});

const habitationListResponseSchema = z.object({
  items: z.array(habitationSummarySchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

const habitationFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      geometry: geoPointSchema,
      properties: habitationSummarySchema.omit({ centroid: true }),
    }),
  ),
});

function toAssessmentSummary(doc: AssessmentDoc): AssessmentSummary {
  return {
    overallZoneClass: doc.overallZoneClass,
    compositeRiskScore: doc.compositeRiskScore,
    vulnerabilityIndex: doc.vulnerabilityIndex,
    relocationPriorityIndex: doc.relocationPriorityIndex,
    priorityBucket: doc.priorityBucket,
    computedAt: doc.computedAt,
  };
}

function toAssessmentDetail(doc: AssessmentDoc): AssessmentDetail {
  return {
    id: doc._id.toString(),
    habitationId: doc.habitationId.toString(),
    districtId: doc.districtId.toString(),
    hazardExposure: doc.hazardExposure,
    vulnerabilityIndex: doc.vulnerabilityIndex,
    vulnerabilityDimensions: doc.vulnerabilityDimensions,
    copingCapacity: doc.copingCapacity,
    compositeRiskScore: doc.compositeRiskScore,
    governingHazard: doc.governingHazard,
    overallZoneClass: doc.overallZoneClass,
    relocationPriorityIndex: doc.relocationPriorityIndex,
    priorityBucket: doc.priorityBucket,
    modelVersion: doc.modelVersion,
    computedAt: doc.computedAt,
    validFrom: doc.validFrom,
    validTo: doc.validTo,
    explanation: doc.explanation,
  };
}

function habitationToSummaryFields(doc: HabitationDoc) {
  return {
    id: (doc._id as Types.ObjectId).toString(),
    lgdHabitationCode: doc.lgdHabitationCode,
    name: doc.name,
    block: doc.block,
    panchayat: doc.panchayat,
    districtId: doc.districtId.toString(),
    centroid: doc.centroid,
    population: doc.population,
    households: doc.households,
    consentStatus: doc.consentStatus,
  };
}

const listQuerySchema = z.object({
  districtId: objectIdString.optional(),
  bucket: priorityBucketSchema.optional(),
  zoneClass: zoneClassSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(LIST_PAGE_SIZE_CAP).default(50),
  format: z.enum(["json", "geojson"]).default("json"),
});

/**
 * GET /api/v1/habitations — the officer's map/list of habitations, filterable
 * by district/priority bucket/zone class, paginated (capped at
 * LIST_PAGE_SIZE_CAP), with an optional GeoJSON FeatureCollection format for
 * direct MapLibre consumption. Fast enough for a map: districtId is indexed
 * on Habitation, and the bucket/zoneClass pre-filter runs against Assessment's
 * {districtId, validTo, priorityBucket|overallZoneClass} compound indexes
 * before the (also indexed) Habitation._id $in lookup — never a post-hoc
 * filter over already-fetched documents.
 */
habitationRouter.get(
  "/habitations",
  authenticate,
  requirePermission(HABITATION_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = listQuerySchema.parse(req.query);

      let districtFilter: Record<string, unknown> = req.scopeFilter ?? {};
      if (query.districtId) {
        const districtId = new Types.ObjectId(query.districtId);
        const district = await requireDistrictInScope(req.scopeFilter, districtId);
        if (!district) {
          res.status(404).json({ error: "District not found or out of scope" });
          return;
        }
        districtFilter = { districtId };
      }

      let habitationIdFilter: Record<string, unknown> = {};
      if (query.bucket || query.zoneClass) {
        const assessmentFilter: Record<string, unknown> = { ...districtFilter, validTo: null };
        if (query.bucket) assessmentFilter.priorityBucket = query.bucket;
        if (query.zoneClass) assessmentFilter.overallZoneClass = query.zoneClass;
        const matches = await Assessment.find(assessmentFilter, { habitationId: 1 }).lean();
        habitationIdFilter = { _id: { $in: matches.map((m) => m.habitationId) } };
      }

      const habitationFilter = { ...districtFilter, ...habitationIdFilter };
      const skip = (query.page - 1) * query.pageSize;
      const [habitations, total] = await Promise.all([
        Habitation.find(habitationFilter).sort({ name: 1 }).skip(skip).limit(query.pageSize),
        Habitation.countDocuments(habitationFilter),
      ]);

      const habitationIds = habitations.map((h) => h._id as Types.ObjectId);
      const activeAssessments = await Assessment.find({
        habitationId: { $in: habitationIds },
        validTo: null,
      });
      const assessmentByHabitation = new Map(
        activeAssessments.map((a) => [a.habitationId.toString(), toAssessmentSummary(a)]),
      );

      const items = habitations.map((h) => ({
        ...habitationToSummaryFields(h),
        assessment: assessmentByHabitation.get((h._id as Types.ObjectId).toString()) ?? null,
      }));

      if (query.format === "geojson") {
        const featureCollection = habitationFeatureCollectionSchema.parse({
          type: "FeatureCollection",
          features: items.map(({ centroid, ...properties }) => ({
            type: "Feature",
            geometry: centroid,
            properties,
          })),
        });
        res.status(200).json(featureCollection);
        return;
      }

      const body = habitationListResponseSchema.parse({
        items,
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      });
      res.status(200).json(body);
    })().catch(next);
  },
);

/** Loads a habitation and confirms it is within the caller's scope, or returns null. */
async function findHabitationInScope(
  scopeFilter: Record<string, unknown> | undefined,
  id: Types.ObjectId,
): Promise<HabitationDoc | null> {
  return Habitation.findOne({ _id: id, ...scopeFilter });
}

const habitationDetailResponseSchema = habitationSummarySchema
  .omit({ assessment: true })
  .extend({
    boundary: z.unknown().optional(),
    demographics: z.unknown(),
    structures: z.unknown(),
    access: z.unknown(),
    livelihood: z.unknown(),
    copingCapacity: z.unknown(),
    dataProvenance: z.string(),
    latestAssessment: assessmentDetailSchema.nullable(),
  });

/** GET /api/v1/habitations/:id — full habitation detail, including the latest (active) Assessment if one exists. */
habitationRouter.get(
  "/habitations/:id",
  authenticate,
  requirePermission(HABITATION_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const parsedId = objectIdString.safeParse(req.params.id);
      if (!parsedId.success) {
        res.status(400).json({ error: "Invalid habitation id" });
        return;
      }
      const habitation = await findHabitationInScope(req.scopeFilter, new Types.ObjectId(parsedId.data));
      if (!habitation) {
        res.status(404).json({ error: "Habitation not found or out of scope" });
        return;
      }

      const latest = await getActiveAssessment({ habitationId: habitation._id as Types.ObjectId });

      const body = habitationDetailResponseSchema.parse({
        ...habitationToSummaryFields(habitation),
        boundary: habitation.boundary,
        demographics: habitation.demographics,
        structures: habitation.structures,
        access: habitation.access,
        livelihood: habitation.livelihood,
        copingCapacity: habitation.copingCapacity,
        dataProvenance: habitation.dataProvenance,
        latestAssessment: latest ? toAssessmentDetail(latest) : null,
      });
      res.status(200).json(body);
    })().catch(next);
  },
);

const assessmentHistoryQuerySchema = z.object({ at: z.coerce.date().optional() });

/** GET /api/v1/habitations/:id/assessment — the active Assessment (default: now), or the one active `?at=` a past instant. */
habitationRouter.get(
  "/habitations/:id/assessment",
  authenticate,
  requirePermission(ASSESSMENT_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const parsedId = objectIdString.safeParse(req.params.id);
      if (!parsedId.success) {
        res.status(400).json({ error: "Invalid habitation id" });
        return;
      }
      const query = assessmentHistoryQuerySchema.parse(req.query);

      const habitation = await findHabitationInScope(req.scopeFilter, new Types.ObjectId(parsedId.data));
      if (!habitation) {
        res.status(404).json({ error: "Habitation not found or out of scope" });
        return;
      }

      const assessment = await getActiveAssessment({
        habitationId: habitation._id as Types.ObjectId,
        ...(query.at ? { at: query.at } : {}),
      });
      if (!assessment) {
        res.status(404).json({
          error: query.at
            ? "No Assessment was active for this habitation at that instant"
            : "This habitation has not been assessed yet — has the pipeline run for its district?",
        });
        return;
      }

      res.status(200).json(assessmentDetailSchema.parse(toAssessmentDetail(assessment)));
    })().catch(next);
  },
);

const explainResponseSchema = z.object({
  habitationId: objectIdString,
  habitationName: z.string(),
  governingHazard: z.string(),
  overallZoneClass: zoneClassSchema,
  relocationPriorityIndex: z.number().min(0).max(1).nullable(),
  priorityBucket: priorityBucketSchema.nullable(),
  hazardExposure: z.array(hazardExposureEntrySchema),
  explanation: z.array(explanationEntrySchema),
  summary: z.string(),
});

/** Renders a one-sentence plain-language synthesis of an Assessment's top factor, for the officer workbench. */
function summarize(habitationName: string, assessment: AssessmentDoc): string {
  const zonePhrase = `a ${assessment.overallZoneClass} ${assessment.governingHazard} zone`;
  if (!assessment.priorityBucket || assessment.relocationPriorityIndex === null) {
    return `${habitationName} sits in ${zonePhrase} but was not bucketed for relocation priority (only Red/Orange habitations receive a priority ranking).`;
  }
  const top = [...assessment.explanation].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0];
  const topLabel = top?.factor === "risk" ? "hazard risk" : (top?.label ?? top?.factor);
  const topPhrase = top
    ? `, driven mainly by ${topLabel} (${top.direction === "INCREASES_RISK" ? "+" : "-"}${Math.abs(top.contribution).toFixed(2)})`
    : "";
  return (
    `${habitationName} sits in ${zonePhrase} and is bucketed "${assessment.priorityBucket}" ` +
    `(RPI ${assessment.relocationPriorityIndex.toFixed(3)})${topPhrase}.`
  );
}

/** GET /api/v1/habitations/:id/explain — the additive RPI/Risk factor breakdown for the latest Assessment, in plain language. */
habitationRouter.get(
  "/habitations/:id/explain",
  authenticate,
  requirePermission(ASSESSMENT_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const parsedId = objectIdString.safeParse(req.params.id);
      if (!parsedId.success) {
        res.status(400).json({ error: "Invalid habitation id" });
        return;
      }
      const habitation = await findHabitationInScope(req.scopeFilter, new Types.ObjectId(parsedId.data));
      if (!habitation) {
        res.status(404).json({ error: "Habitation not found or out of scope" });
        return;
      }

      const assessment = await getActiveAssessment({ habitationId: habitation._id as Types.ObjectId });
      if (!assessment) {
        res.status(404).json({
          error: "This habitation has not been assessed yet — has the pipeline run for its district?",
        });
        return;
      }

      const body = explainResponseSchema.parse({
        habitationId: (habitation._id as Types.ObjectId).toString(),
        habitationName: habitation.name,
        governingHazard: assessment.governingHazard,
        overallZoneClass: assessment.overallZoneClass,
        relocationPriorityIndex: assessment.relocationPriorityIndex,
        priorityBucket: assessment.priorityBucket,
        hazardExposure: assessment.hazardExposure,
        explanation: assessment.explanation,
        summary: summarize(habitation.name, assessment),
      });
      res.status(200).json(body);
    })().catch(next);
  },
);

const prioritiesQuerySchema = z.object({
  districtId: objectIdString.optional(),
  bucket: priorityBucketSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(LIST_PAGE_SIZE_CAP).default(50),
});

const priorityItemSchema = z.object({
  habitationId: objectIdString,
  habitationName: z.string(),
  districtId: objectIdString,
  overallZoneClass: zoneClassSchema,
  governingHazard: z.string(),
  vulnerabilityIndex: z.number().min(0).max(1),
  compositeRiskScore: z.number().min(0).max(1),
  relocationPriorityIndex: z.number().min(0).max(1),
  priorityBucket: priorityBucketSchema,
  topFactor: explanationEntrySchema.nullable(),
  computedAt: z.date(),
});

const prioritiesResponseSchema = z.object({
  items: z.array(priorityItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

/**
 * GET /api/v1/priorities — the officer's worklist: active, RPI-eligible
 * (Red/Orange) Assessments ranked by relocationPriorityIndex descending,
 * optionally filtered to one district/bucket. RPI is a within-run relative
 * ranking (docs/METHODOLOGY.md §3), so this list is meaningful per
 * district/run — cross-district ordering is not a claim this endpoint makes.
 */
habitationRouter.get(
  "/priorities",
  authenticate,
  requirePermission(ASSESSMENT_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = prioritiesQuerySchema.parse(req.query);

      let districtFilter: Record<string, unknown> = req.scopeFilter ?? {};
      if (query.districtId) {
        const districtId = new Types.ObjectId(query.districtId);
        const district = await requireDistrictInScope(req.scopeFilter, districtId);
        if (!district) {
          res.status(404).json({ error: "District not found or out of scope" });
          return;
        }
        districtFilter = { districtId };
      }

      const filter: Record<string, unknown> = {
        ...districtFilter,
        validTo: null,
        priorityBucket: query.bucket ?? { $ne: null },
      };

      const skip = (query.page - 1) * query.pageSize;
      const [assessments, total] = await Promise.all([
        Assessment.find(filter)
          .sort({ relocationPriorityIndex: -1 })
          .skip(skip)
          .limit(query.pageSize)
          .populate<{ habitationId: HabitationDoc }>("habitationId", "name districtId"),
        Assessment.countDocuments(filter),
      ]);

      const items = assessments.map((a) => {
        const habitation = a.habitationId as unknown as HabitationDoc;
        const topFactor =
          [...a.explanation].sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution))[0] ?? null;
        return priorityItemSchema.parse({
          habitationId: (habitation._id as Types.ObjectId).toString(),
          habitationName: habitation.name,
          districtId: a.districtId.toString(),
          overallZoneClass: a.overallZoneClass,
          governingHazard: a.governingHazard,
          vulnerabilityIndex: a.vulnerabilityIndex,
          compositeRiskScore: a.compositeRiskScore,
          relocationPriorityIndex: a.relocationPriorityIndex,
          priorityBucket: a.priorityBucket,
          topFactor,
          computedAt: a.computedAt,
        });
      });

      const body = prioritiesResponseSchema.parse({
        items,
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      });
      res.status(200).json(body);
    })().catch(next);
  },
);
