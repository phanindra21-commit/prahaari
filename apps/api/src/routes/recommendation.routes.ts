import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { PRIORITY_BUCKETS, RECOMMENDATION_STATUSES } from "@punarvas/shared";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { Recommendation } from "../models/Recommendation";

export const recommendationRouter = Router();

const RECOMMENDATION_READ = "recommendation:read";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const listQuerySchema = z.object({
  districtId: objectIdString.optional(),
  priorityBucket: z.enum(PRIORITY_BUCKETS).optional(),
  status: z.enum(RECOMMENDATION_STATUSES).optional(),
});

/**
 * GET /api/v1/recommendations — the officer review queue: system-
 * generated habitation-to-site recommendations (siteStage.ts), scoped to
 * the caller's district(s) by `requireScope()`, optionally filtered by
 * priorityBucket/status. Sorted Immediate-before-ShortTerm-before-
 * MediumTerm, then most recently generated first within a bucket.
 */
recommendationRouter.get(
  "/recommendations",
  authenticate,
  requirePermission(RECOMMENDATION_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = listQuerySchema.parse(req.query);
      const filter: Record<string, unknown> = { ...req.scopeFilter };
      if (query.districtId) {
        filter.districtId = new Types.ObjectId(query.districtId);
      }
      if (query.priorityBucket) {
        filter.priorityBucket = query.priorityBucket;
      }
      if (query.status) {
        filter.status = query.status;
      }

      const recommendations = await Recommendation.find(filter)
        .populate("habitationId")
        .populate("candidateSites.relocationSiteId")
        .sort({ generatedAt: -1 });

      const bucketRank: Record<string, number> = { Immediate: 0, ShortTerm: 1, MediumTerm: 2 };
      recommendations.sort((a, b) => (bucketRank[a.priorityBucket] ?? 99) - (bucketRank[b.priorityBucket] ?? 99));

      res.status(200).json({ items: recommendations });
    })().catch(next);
  },
);

/** GET /api/v1/recommendations/:id — a single recommendation's full detail. */
recommendationRouter.get(
  "/recommendations/:id",
  authenticate,
  requirePermission(RECOMMENDATION_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const id = req.params.id;
      if (!id || !Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: "Invalid recommendation id" });
        return;
      }
      const recommendation = await Recommendation.findOne({ _id: id, ...req.scopeFilter })
        .populate("habitationId")
        .populate("candidateSites.relocationSiteId");
      if (!recommendation) {
        res.status(404).json({ error: "Recommendation not found or out of scope" });
        return;
      }
      res.status(200).json(recommendation);
    })().catch(next);
  },
);
