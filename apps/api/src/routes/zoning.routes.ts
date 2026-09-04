import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { HAZARD_TYPES } from "@punarvas/shared";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { District, type DistrictDoc } from "../models/District";
import { GridCell } from "../models/GridCell";
import { HazardZone } from "../models/HazardZone";
import { Job } from "../models/Job";
import { getActiveZones } from "../lib/zoneVersioning";
import { runZoningJob } from "../lib/jobs/zoningJob";
import { runPipelineJob } from "../lib/jobs/pipelineJob";

export const zoningRouter = Router();

const PIPELINE_RUN = "pipeline:run";
const HAZARD_ZONE_READ = "hazardZone:read";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

/** Verifies `districtId` both exists AND is within the authenticated user's
 * scope, in one pre-query filter — never a post-hoc check on an already-fetched doc. */
async function requireDistrictInScope(
  scopeFilter: Record<string, unknown> | undefined,
  districtId: Types.ObjectId,
): Promise<DistrictDoc | null> {
  return District.findOne({ _id: districtId, ...scopeFilter });
}

const runRequestSchema = z.object({
  districtId: objectIdString,
  hazardTypes: z.array(z.enum(HAZARD_TYPES)).min(1).optional(),
});

/** POST /api/v1/zoning/run — starts an in-process zoning job for a district's hazards. */
zoningRouter.post(
  "/zoning/run",
  authenticate,
  requirePermission(PIPELINE_RUN),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const body = runRequestSchema.parse(req.body);
      const districtId = new Types.ObjectId(body.districtId);

      const district = await requireDistrictInScope(req.scopeFilter, districtId);
      if (!district) {
        res.status(404).json({ error: "District not found or out of scope" });
        return;
      }

      const hazardTypes = body.hazardTypes ?? district.primaryHazards;
      const unsupported = hazardTypes.filter((h) => !district.primaryHazards.includes(h));
      if (unsupported.length > 0) {
        res.status(422).json({
          error: `District "${district.name}" does not list these as primary hazards: ${unsupported.join(", ")}`,
        });
        return;
      }

      const job = await Job.create({
        type: "ZONING_RUN",
        districtId,
        status: "PENDING",
        params: { districtId: districtId.toString(), hazardTypes },
        createdBy: req.auth!.userId,
      });

      res.locals.auditEntity = {
        entityType: "job",
        entityId: job._id.toString(),
        after: { districtId: districtId.toString(), hazardTypes },
      };
      res.status(202).json({ jobId: job._id.toString(), status: job.status, hazardTypes });

      const actor = {
        actorId: req.auth!.userId,
        actorLabel: req.auth!.userId.toString(),
        requestId: req.requestId,
        ipAddress: req.ip ?? "unknown",
        userAgent: req.header("User-Agent") ?? "unknown",
      };
      // Fire-and-forget: runZoningJob never throws (every failure is caught,
      // recorded on the Job doc, and audited internally) — no queue, per
      // CLAUDE.md's Step 4 roadmap entry ("in-process job runner").
      void runZoningJob(job._id as Types.ObjectId, actor);
    })().catch(next);
  },
);

/** POST /api/v1/pipeline/run — the full pipeline (zones -> habitation
 * assessments -> priorities) for a district, in one job. ANALYST+ per
 * permissions.json's existing pipeline:run grant (SUPER_ADMIN,
 * STATE_ADMIN, ANALYST). */
zoningRouter.post(
  "/pipeline/run",
  authenticate,
  requirePermission(PIPELINE_RUN),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const body = runRequestSchema.parse(req.body);
      const districtId = new Types.ObjectId(body.districtId);

      const district = await requireDistrictInScope(req.scopeFilter, districtId);
      if (!district) {
        res.status(404).json({ error: "District not found or out of scope" });
        return;
      }

      const hazardTypes = body.hazardTypes ?? district.primaryHazards;
      const unsupported = hazardTypes.filter((h) => !district.primaryHazards.includes(h));
      if (unsupported.length > 0) {
        res.status(422).json({
          error: `District "${district.name}" does not list these as primary hazards: ${unsupported.join(", ")}`,
        });
        return;
      }

      const job = await Job.create({
        type: "PIPELINE_RUN",
        districtId,
        status: "PENDING",
        params: { districtId: districtId.toString(), hazardTypes },
        createdBy: req.auth!.userId,
      });

      res.locals.auditEntity = {
        entityType: "job",
        entityId: job._id.toString(),
        after: { districtId: districtId.toString(), hazardTypes },
      };
      res.status(202).json({ jobId: job._id.toString(), status: job.status, hazardTypes });

      const actor = {
        actorId: req.auth!.userId,
        actorLabel: req.auth!.userId.toString(),
        requestId: req.requestId,
        ipAddress: req.ip ?? "unknown",
        userAgent: req.header("User-Agent") ?? "unknown",
      };
      // Fire-and-forget: runPipelineJob never throws (every failure is
      // caught, recorded on the Job doc, and audited internally) — no
      // queue, same in-process pattern as runZoningJob.
      void runPipelineJob(job._id as Types.ObjectId, actor);
    })().catch(next);
  },
);

/** GET /api/v1/zoning/runs/:id — job status/result. */
zoningRouter.get(
  "/zoning/runs/:id",
  authenticate,
  requirePermission(PIPELINE_RUN),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const id = req.params.id;
      if (!id || !Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: "Invalid job id" });
        return;
      }
      const job = await Job.findOne({ _id: id, ...req.scopeFilter });
      if (!job) {
        res.status(404).json({ error: "Job not found or out of scope" });
        return;
      }
      res.status(200).json(job);
    })().catch(next);
  },
);

const zonesQuerySchema = z.object({
  districtId: objectIdString,
  hazardType: z.enum(HAZARD_TYPES).optional(),
});

/** GET /api/v1/zones — the currently-active zone polygons for a district (optionally one hazard). */
zoningRouter.get(
  "/zones",
  authenticate,
  requirePermission(HAZARD_ZONE_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = zonesQuerySchema.parse(req.query);
      const districtId = new Types.ObjectId(query.districtId);

      const district = await requireDistrictInScope(req.scopeFilter, districtId);
      if (!district) {
        res.status(404).json({ error: "District not found or out of scope" });
        return;
      }

      const zones = await getActiveZones({
        districtId,
        ...(query.hazardType ? { hazardType: query.hazardType } : {}),
      });
      res.status(200).json({ items: zones });
    })().catch(next);
  },
);

/** GET /api/v1/zones/history — every zone version for a district (optionally one hazard), newest first. */
zoningRouter.get(
  "/zones/history",
  authenticate,
  requirePermission(HAZARD_ZONE_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = zonesQuerySchema.parse(req.query);
      const districtId = new Types.ObjectId(query.districtId);

      const district = await requireDistrictInScope(req.scopeFilter, districtId);
      if (!district) {
        res.status(404).json({ error: "District not found or out of scope" });
        return;
      }

      const filter: Record<string, unknown> = { districtId };
      if (query.hazardType) {
        filter.hazardType = query.hazardType;
      }
      const zones = await HazardZone.find(filter).sort({ validFrom: -1 });
      res.status(200).json({ items: zones });
    })().catch(next);
  },
);

const GRID_RESPONSE_CAP = 5000;

const gridQuerySchema = z.object({
  districtId: objectIdString,
  minLon: z.coerce.number().min(-180).max(180),
  minLat: z.coerce.number().min(-90).max(90),
  maxLon: z.coerce.number().min(-180).max(180),
  maxLat: z.coerce.number().min(-90).max(90),
});

/** GET /api/v1/grid — GridCell docs within a bbox, capped at GRID_RESPONSE_CAP. */
zoningRouter.get(
  "/grid",
  authenticate,
  requirePermission(HAZARD_ZONE_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = gridQuerySchema.parse(req.query);
      if (query.minLon >= query.maxLon || query.minLat >= query.maxLat) {
        res.status(422).json({ error: "minLon must be < maxLon and minLat must be < maxLat" });
        return;
      }
      const districtId = new Types.ObjectId(query.districtId);

      const district = await requireDistrictInScope(req.scopeFilter, districtId);
      if (!district) {
        res.status(404).json({ error: "District not found or out of scope" });
        return;
      }

      const bboxPolygon = {
        type: "Polygon" as const,
        coordinates: [
          [
            [query.minLon, query.minLat],
            [query.maxLon, query.minLat],
            [query.maxLon, query.maxLat],
            [query.minLon, query.maxLat],
            [query.minLon, query.minLat],
          ],
        ],
      };
      const geoFilter = { districtId, centroid: { $geoWithin: { $geometry: bboxPolygon } } };

      const [cells, totalMatching] = await Promise.all([
        GridCell.find(geoFilter).limit(GRID_RESPONSE_CAP).lean(),
        GridCell.countDocuments(geoFilter),
      ]);

      res.status(200).json({
        items: cells,
        returned: cells.length,
        totalMatching,
        capped: totalMatching > GRID_RESPONSE_CAP,
      });
    })().catch(next);
  },
);

const explainQuerySchema = z.object({ hazardType: z.enum(HAZARD_TYPES) });

/** GET /api/v1/grid/:h3Index/explain — the SHAP top factors stored for this cell's most recent zoning run. */
zoningRouter.get(
  "/grid/:h3Index/explain",
  authenticate,
  requirePermission(HAZARD_ZONE_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = explainQuerySchema.parse(req.query);

      const cell = await GridCell.findOne({ h3Index: req.params.h3Index });
      if (!cell) {
        res.status(404).json({ error: "Grid cell not found" });
        return;
      }

      const district = await requireDistrictInScope(req.scopeFilter, cell.districtId);
      if (!district) {
        res.status(404).json({ error: "Grid cell not found or out of scope" });
        return;
      }

      const topFactors = cell.explanations.get(query.hazardType);
      if (!topFactors) {
        res.status(404).json({
          error: `No explanation stored for hazard "${query.hazardType}" on this cell yet — has a zoning run scored it?`,
        });
        return;
      }
      res.status(200).json({ h3Index: cell.h3Index, hazardType: query.hazardType, topFactors });
    })().catch(next);
  },
);
