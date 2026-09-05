import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { DECISION_ACTIONS, justificationSchema } from "@punarvas/shared";
import type { DecisionAction } from "@punarvas/shared";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { requireDistrictInScope } from "../lib/districtScope";
import { Decision } from "../models/Decision";
import { Recommendation, type RecommendationDoc } from "../models/Recommendation";

export const decisionRouter = Router();

const RECOMMENDATION_APPROVE = "recommendation:approve";
const DECISION_READ = "decision:read";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

/** Maps a decision action to the Recommendation.status it produces —
 * DECISION_ACTIONS ("APPROVE"|"MODIFY"|"REJECT"|"DEFER") and
 * RECOMMENDATION_STATUSES don't share spelling ("APPROVE" -> "APPROVED"),
 * so this mapping is the single place that translation happens. */
const STATUS_FOR_ACTION: Record<DecisionAction, RecommendationDoc["status"]> = {
  APPROVE: "APPROVED",
  MODIFY: "MODIFIED",
  REJECT: "REJECTED",
  DEFER: "DEFERRED",
};

/** Fields a MODIFY decision is allowed to change on a Recommendation —
 * an officer can pick a different site, a different household count, or
 * a different phasing plan, and every change must be named exactly here
 * so an arbitrary field can never be silently overwritten. */
const MODIFIABLE_FIELDS = new Set(["selectedSiteId", "estimatedHouseholdsToMove", "phasing"]);

const overriddenFieldRequestSchema = z.object({
  field: z.string().min(1),
  fromValue: z.unknown(),
  toValue: z.unknown(),
});
type OverriddenFieldRequest = z.infer<typeof overriddenFieldRequestSchema>;

const createDecisionRequestSchema = z.object({
  recommendationId: objectIdString,
  action: z.enum(DECISION_ACTIONS),
  justification: justificationSchema,
  overriddenFields: z.array(overriddenFieldRequestSchema).default([]),
});

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Applies one validated override to `recommendation` in place. Throws a
 * plain Error with a `.status` the route handler translates to the right
 * HTTP code — kept local to this file since no other route needs it. */
function applyOverride(recommendation: RecommendationDoc, override: OverriddenFieldRequest): void {
  if (override.field === "selectedSiteId") {
    if (typeof override.toValue !== "string" || !Types.ObjectId.isValid(override.toValue)) {
      throw Object.assign(new Error("overriddenFields.selectedSiteId.toValue must be a valid ObjectId"), {
        status: 422,
      });
    }
    const candidateIds = recommendation.candidateSites.map((c) => c.relocationSiteId.toString());
    if (!candidateIds.includes(override.toValue)) {
      throw Object.assign(
        new Error("overriddenFields.selectedSiteId.toValue must be one of this recommendation's candidateSites"),
        { status: 422 },
      );
    }
    recommendation.selectedSiteId = new Types.ObjectId(override.toValue);
    return;
  }
  if (override.field === "estimatedHouseholdsToMove") {
    if (typeof override.toValue !== "number" || !Number.isInteger(override.toValue) || override.toValue < 0) {
      throw Object.assign(
        new Error("overriddenFields.estimatedHouseholdsToMove.toValue must be a non-negative integer"),
        { status: 422 },
      );
    }
    recommendation.estimatedHouseholdsToMove = override.toValue;
    return;
  }
  if (override.field === "phasing") {
    const parsed = z
      .array(
        z.object({
          phase: z.number().int().positive(),
          householdCount: z.number().int().nonnegative(),
          targetDate: z.coerce.date(),
        }),
      )
      .safeParse(override.toValue);
    if (!parsed.success) {
      throw Object.assign(new Error(`overriddenFields.phasing.toValue is invalid: ${parsed.error.toString()}`), {
        status: 422,
      });
    }
    recommendation.phasing = parsed.data;
    return;
  }
  throw Object.assign(new Error(`Unknown or non-modifiable field: "${override.field}"`), { status: 422 });
}

/**
 * POST /api/v1/decisions — the human-in-the-loop action: an officer
 * approves, modifies, rejects, or defers one Recommendation. Justification
 * is mandatory (>= 30 chars, enforced both here via Zod and client-side)
 * per CLAUDE.md's "officer actions are never silent" rule. Every changed
 * field on a MODIFY is recorded with its from/to values on the Decision
 * document; the generic autoAudit middleware (see app.ts) writes the
 * hash-chained AuditLog entry once `res.locals.auditEntity` is set below.
 */
decisionRouter.post(
  "/decisions",
  authenticate,
  requirePermission(RECOMMENDATION_APPROVE),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const body = createDecisionRequestSchema.parse(req.body);

      if (body.action === "MODIFY" && body.overriddenFields.length === 0) {
        res.status(422).json({ error: "A MODIFY decision requires at least one entry in overriddenFields" });
        return;
      }
      if (body.action !== "MODIFY" && body.overriddenFields.length > 0) {
        res.status(422).json({ error: "overriddenFields is only accepted for a MODIFY decision" });
        return;
      }
      for (const override of body.overriddenFields) {
        if (!MODIFIABLE_FIELDS.has(override.field)) {
          res.status(422).json({
            error: `"${override.field}" is not a modifiable field. Allowed: ${[...MODIFIABLE_FIELDS].join(", ")}`,
          });
          return;
        }
      }

      const recommendation = await Recommendation.findOne({
        _id: new Types.ObjectId(body.recommendationId),
        ...req.scopeFilter,
      });
      if (!recommendation) {
        res.status(404).json({ error: "Recommendation not found or out of scope" });
        return;
      }
      if (recommendation.status !== "PENDING_REVIEW") {
        res.status(409).json({
          error: `This recommendation was already decided (status: ${recommendation.status}). Each recommendation accepts exactly one decision.`,
        });
        return;
      }

      const beforeSnapshot = {
        status: recommendation.status,
        selectedSiteId: recommendation.selectedSiteId?.toString() ?? null,
        estimatedHouseholdsToMove: recommendation.estimatedHouseholdsToMove,
        phasing: recommendation.phasing,
      };

      for (const override of body.overriddenFields) {
        const currentValue =
          override.field === "selectedSiteId"
            ? (recommendation.selectedSiteId?.toString() ?? null)
            : (recommendation as unknown as Record<string, unknown>)[override.field];
        if (!valuesEqual(currentValue, override.fromValue)) {
          res.status(409).json({
            error:
              `overriddenFields.${override.field}.fromValue does not match the recommendation's current value ` +
              "— it may have changed since you loaded this page. Reload and try again.",
          });
          return;
        }
        try {
          applyOverride(recommendation, override);
        } catch (error) {
          const status = (error as { status?: number }).status ?? 422;
          res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
          return;
        }
      }

      recommendation.status = STATUS_FOR_ACTION[body.action];
      await recommendation.save();

      const decision = await Decision.create({
        recommendationId: recommendation._id,
        districtId: recommendation.districtId,
        officerId: req.auth!.userId,
        action: body.action,
        justification: body.justification,
        overriddenFields: body.overriddenFields,
        decidedAt: new Date(),
        ipAddress: req.ip ?? "unknown",
      });

      res.locals.auditEntity = {
        entityType: "decision",
        entityId: decision._id.toString(),
        before: beforeSnapshot,
        after: {
          status: recommendation.status,
          selectedSiteId: recommendation.selectedSiteId?.toString() ?? null,
          estimatedHouseholdsToMove: recommendation.estimatedHouseholdsToMove,
          phasing: recommendation.phasing,
          overriddenFields: body.overriddenFields,
        },
      };
      res.status(201).json({ decision, recommendation });
    })().catch(next);
  },
);

const listQuerySchema = z.object({
  recommendationId: objectIdString.optional(),
  districtId: objectIdString.optional(),
});

/** GET /api/v1/decisions — decisions for a recommendation (usually 0 or 1: a
 * PENDING_REVIEW recommendation accepts exactly one decision) or for a
 * whole district (Step 9 Part 2A's situation report needs "every decision
 * taken in this district", not just one recommendation's) — always scoped
 * to the caller's district(s) first. */
decisionRouter.get("/decisions", authenticate, requirePermission(DECISION_READ), requireScope(), (req, res, next) => {
  void (async () => {
    const query = listQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { ...req.scopeFilter };
    if (query.recommendationId) {
      filter.recommendationId = new Types.ObjectId(query.recommendationId);
    }
    if (query.districtId) {
      // SECURITY: verify against the caller's own scope before use — see
      // recommendation.routes.ts's identical fix for why blindly trusting
      // an explicit ?districtId= is a scope bypass.
      const districtId = new Types.ObjectId(query.districtId);
      const district = await requireDistrictInScope({ role: req.auth!.role, ...req.auth!.scope }, districtId);
      if (!district) {
        res.status(404).json({ error: "District not found or out of scope" });
        return;
      }
      filter.districtId = districtId;
    }
    const decisions = await Decision.find(filter).populate("officerId", "name email role").sort({ decidedAt: -1 });
    res.status(200).json({ items: decisions });
  })().catch(next);
});
