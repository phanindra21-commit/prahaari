import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { HAZARD_TYPES } from "@prahari/shared";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { requireDistrictInScope } from "../lib/districtScope";
import { HazardEvent } from "../models/HazardEvent";

export const hazardEventRouter = Router();

const HAZARD_EVENT_READ = "hazardEvent:read";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const listQuerySchema = z.object({
  districtId: objectIdString.optional(),
  hazardType: z.enum(HAZARD_TYPES).optional(),
});

/** GET /api/v1/hazard-events — the recorded disaster-history inventory, filterable
 * by district/hazard type. Small (a handful of records in this pilot), so unpaginated. */
hazardEventRouter.get(
  "/hazard-events",
  authenticate,
  requirePermission(HAZARD_EVENT_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = listQuerySchema.parse(req.query);

      // A query districtId must be verified in scope, never merged
      // straight into the scope filter — merging would let a caller
      // silently overwrite their own scoped districtId with a
      // different one via the query string.
      let filter: Record<string, unknown> = { ...req.scopeFilter };
      if (query.districtId) {
        const districtId = new Types.ObjectId(query.districtId);
        const district = await requireDistrictInScope(
          { role: req.auth!.role, ...req.auth!.scope },
          districtId,
        );
        if (!district) {
          res.status(404).json({ error: "District not found or out of scope" });
          return;
        }
        filter = { districtId };
      }
      if (query.hazardType) filter.hazardType = query.hazardType;

      const events = await HazardEvent.find(filter).sort({ date: -1 });
      res.status(200).json({ items: events });
    })().catch(next);
  },
);
