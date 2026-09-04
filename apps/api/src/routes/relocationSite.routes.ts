import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { requireDistrictInScope } from "../lib/districtScope";
import { RelocationSite } from "../models/RelocationSite";

export const relocationSiteRouter = Router();

const RELOCATION_SITE_READ = "relocationSite:read";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const listQuerySchema = z.object({ districtId: objectIdString });

/**
 * GET /api/v1/relocation-sites — candidate site markers for a district. Site
 * suitability/carrying-capacity scoring (Step 9/10) is not built yet, so
 * `overallSuitabilityScore`/`carryingCapacity` are null on every seeded
 * site today — the map renders them as unscored candidates, not a ranked
 * list, until that scoring pipeline exists.
 */
relocationSiteRouter.get(
  "/relocation-sites",
  authenticate,
  requirePermission(RELOCATION_SITE_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = listQuerySchema.parse(req.query);
      const districtId = new Types.ObjectId(query.districtId);
      const district = await requireDistrictInScope(
        { role: req.auth!.role, ...req.auth!.scope },
        districtId,
      );
      if (!district) {
        res.status(404).json({ error: "District not found or out of scope" });
        return;
      }

      const sites = await RelocationSite.find({ districtId });
      res.status(200).json({ items: sites });
    })().catch(next);
  },
);
