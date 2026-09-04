import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { scenarioParametersSchema } from "@punarvas/shared";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { requireDistrictInScope } from "../lib/districtScope";
import { ScenarioRun } from "../models/ScenarioRun";
import { runDistrictScenario } from "../lib/scenarioRunner";

export const scenarioRouter = Router();

const SCENARIO_RUN = "scenario:run";
const SCENARIO_READ = "scenario:read";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const runScenarioRequestSchema = z.object({
  districtId: objectIdString,
  name: z.string().trim().min(1).max(200),
  parameters: scenarioParametersSchema,
});

/**
 * POST /api/v1/scenarios/run — Step 8 Part 2: runs a what-if scenario
 * SYNCHRONOUSLY (no job queue — measured true runtime is ~4-7s for a
 * full district, see docs/METHODOLOGY.md, well within a single request)
 * and persists the result onto a new ScenarioRun document. Nothing else
 * is written: the district's active HazardZone/Assessment documents are
 * completely untouched — see scenarioRunner.ts's module docstring.
 */
scenarioRouter.post(
  "/scenarios/run",
  authenticate,
  requirePermission(SCENARIO_RUN),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const body = runScenarioRequestSchema.parse(req.body);
      const districtId = new Types.ObjectId(body.districtId);

      const district = await requireDistrictInScope({ role: req.auth!.role, ...req.auth!.scope }, districtId);
      if (!district) {
        res.status(404).json({ error: "District not found or out of scope" });
        return;
      }

      const scenarioRun = await runDistrictScenario(districtId, body.name, body.parameters, req.auth!.userId);

      res.locals.auditEntity = {
        entityType: "scenarioRun",
        entityId: scenarioRun._id.toString(),
        after: {
          districtId: body.districtId,
          parameters: body.parameters,
          runtimeSeconds: scenarioRun.runtimeSeconds,
          habitationsEnteringImmediate: scenarioRun.habitationsEnteringImmediate,
        },
      };
      res.status(201).json(scenarioRun);
    })().catch((error: unknown) => {
      const status = (error as { status?: number }).status;
      if (status) {
        res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
      next(error);
    });
  },
);

const listQuerySchema = z.object({ districtId: objectIdString.optional() });

/** GET /api/v1/scenarios — saved scenario runs, most recent first,
 * scoped to the caller's district(s), optionally filtered to one. */
scenarioRouter.get("/scenarios", authenticate, requirePermission(SCENARIO_READ), requireScope(), (req, res, next) => {
  void (async () => {
    const query = listQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { ...req.scopeFilter };
    if (query.districtId) {
      filter.districtId = new Types.ObjectId(query.districtId);
    }
    const scenarioRuns = await ScenarioRun.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ items: scenarioRuns });
  })().catch(next);
});

/** GET /api/v1/scenarios/:id — one saved scenario run's full detail
 * (parameters + every delta), for reloading onto the map. */
scenarioRouter.get(
  "/scenarios/:id",
  authenticate,
  requirePermission(SCENARIO_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const id = req.params.id;
      if (!id || !Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: "Invalid scenario id" });
        return;
      }
      const scenarioRun = await ScenarioRun.findOne({ _id: id, ...req.scopeFilter });
      if (!scenarioRun) {
        res.status(404).json({ error: "Scenario run not found or out of scope" });
        return;
      }
      res.status(200).json(scenarioRun);
    })().catch(next);
  },
);

/** DELETE /api/v1/scenarios/:id — discards a saved scenario run. Gated
 * on `scenario:run` (not a separate `scenario:delete` permission — the
 * RBAC matrix already grants every role that can run a scenario the
 * ability to clean up its own hypothetical, non-authoritative results). */
scenarioRouter.delete(
  "/scenarios/:id",
  authenticate,
  requirePermission(SCENARIO_RUN),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const id = req.params.id;
      if (!id || !Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: "Invalid scenario id" });
        return;
      }
      const scenarioRun = await ScenarioRun.findOne({ _id: id, ...req.scopeFilter });
      if (!scenarioRun) {
        res.status(404).json({ error: "Scenario run not found or out of scope" });
        return;
      }
      res.locals.auditEntity = {
        entityType: "scenarioRun",
        entityId: scenarioRun._id.toString(),
        before: { name: scenarioRun.name, districtId: scenarioRun.districtId.toString() },
      };
      await ScenarioRun.deleteOne({ _id: scenarioRun._id });
      res.status(200).json({ deleted: true });
    })().catch(next);
  },
);
