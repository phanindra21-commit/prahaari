import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { requireScope } from "../middleware/requireScope";
import { requireDistrictInScope } from "../lib/districtScope";
import { Habitation } from "../models/Habitation";
import { FieldReport } from "../models/FieldReport";

export const fieldReportRouter = Router();

const FIELD_REPORT_READ = "fieldReport:read";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const listQuerySchema = z.object({
  districtId: objectIdString.optional(),
  habitationId: objectIdString.optional(),
});

/**
 * GET /api/v1/field-reports — ground-truth observations submitted by field
 * staff, scoped like everything else (district/state via the submitting
 * user's own habitations, never a post-hoc filter). FieldReport has no
 * districtId of its own, so scope is resolved by first finding the
 * caller's in-scope habitations, then filtering reports to that set.
 *
 * FIELD_VOLUNTEER always sees only their OWN submitted reports (Step 10
 * Part 4B: "their own submitted field reports", not the district's whole
 * inventory) — every other role with fieldReport:read (ANALYST,
 * DISTRICT_OFFICER, ...) sees every report in their scope. Built alongside
 * the new field-appropriate report page; no submission endpoint exists yet
 * (out of scope for that fix — see Part 4B's status notes), so this list
 * is honestly empty until one does.
 */
fieldReportRouter.get(
  "/field-reports",
  authenticate,
  requirePermission(FIELD_REPORT_READ),
  requireScope(),
  (req, res, next) => {
    void (async () => {
      const query = listQuerySchema.parse(req.query);

      let habitationScopeFilter: Record<string, unknown> = { ...req.scopeFilter };
      if (query.districtId) {
        const districtId = new Types.ObjectId(query.districtId);
        const district = await requireDistrictInScope({ role: req.auth!.role, ...req.auth!.scope }, districtId);
        if (!district) {
          res.status(404).json({ error: "District not found or out of scope" });
          return;
        }
        habitationScopeFilter = { districtId };
      }

      const habitationIds = (
        await Habitation.find(habitationScopeFilter, { _id: 1 }).lean()
      ).map((h) => h._id);

      const filter: Record<string, unknown> = { habitationId: { $in: habitationIds } };
      if (query.habitationId) {
        filter.habitationId = new Types.ObjectId(query.habitationId);
      }
      if (req.auth!.role === "FIELD_VOLUNTEER") {
        filter.submittedBy = req.auth!.userId;
      }

      const reports = await FieldReport.find(filter)
        .populate("habitationId", "name districtId")
        .populate("submittedBy", "name")
        .sort({ createdAt: -1 });

      res.status(200).json({ items: reports });
    })().catch(next);
  },
);
