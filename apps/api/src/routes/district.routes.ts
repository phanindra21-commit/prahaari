import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { District } from "../models/District";

export const districtRouter = Router();

const DISTRICT_READ = "district:read";

/** GET /api/v1/districts — every district in the caller's scope, for the web app's district switcher.
 * Scoped by the District's own `_id` (not a `districtId` field — a District document IS the district). */
districtRouter.get(
  "/districts",
  authenticate,
  requirePermission(DISTRICT_READ),
  requireScope({ districtField: "_id" }),
  (req, res, next) => {
    void District.find({ ...req.scopeFilter })
      .sort({ name: 1 })
      .then((districts) => {
        res.status(200).json({ items: districts });
      })
      .catch(next);
  },
);
