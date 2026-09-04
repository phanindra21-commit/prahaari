import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { requireDistrictInScope } from "../lib/districtScope";
import { RelocationSite } from "../models/RelocationSite";

export const sitesRouter = Router();

const RELOCATION_SITE_READ = "relocationSite:read";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const listQuerySchema = z.object({
  districtId: objectIdString,
  excluded: z.enum(["true", "false"]).optional(),
});

/**
 * GET /api/v1/sites — candidate relocation sites for a district, with
 * their exclusion result and (if not excluded) suitability sub-scores +
 * carrying capacity, once services/ml's site-scoring stage has run
 * (POST /api/v1/pipeline/run — see siteStage.ts). Sorted by
 * overallSuitabilityScore descending; excluded/unscored sites (null
 * score) sort last.
 */
sitesRouter.get(
  "/sites",
  authenticate,
  requirePermission(RELOCATION_SITE_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = listQuerySchema.parse(req.query);
      const districtId = new Types.ObjectId(query.districtId);
      const district = await requireDistrictInScope({ role: req.auth!.role, ...req.auth!.scope }, districtId);
      if (!district) {
        res.status(404).json({ error: "District not found or out of scope" });
        return;
      }

      const filter: Record<string, unknown> = { districtId };
      if (query.excluded === "true") {
        filter["exclusionsFailed.0"] = { $exists: true };
      } else if (query.excluded === "false") {
        filter["exclusionsFailed.0"] = { $exists: false };
      }

      const sites = await RelocationSite.find(filter).sort({ overallSuitabilityScore: -1 });
      res.status(200).json({ items: sites });
    })().catch(next);
  },
);

/** GET /api/v1/sites/:id — a single candidate site's full scoring detail. */
sitesRouter.get(
  "/sites/:id",
  authenticate,
  requirePermission(RELOCATION_SITE_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const id = req.params.id;
      if (!id || !Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: "Invalid site id" });
        return;
      }
      const site = await RelocationSite.findById(id);
      if (!site) {
        res.status(404).json({ error: "Site not found" });
        return;
      }
      const district = await requireDistrictInScope({ role: req.auth!.role, ...req.auth!.scope }, site.districtId);
      if (!district) {
        res.status(404).json({ error: "Site not found or out of scope" });
        return;
      }
      res.status(200).json(site);
    })().catch(next);
  },
);
