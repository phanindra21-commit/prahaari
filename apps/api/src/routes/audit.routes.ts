import { Router } from "express";
import { z } from "zod";
import { AuditLog } from "../models/AuditLog";
import { verifyAuditChain } from "../lib/audit";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";

export const auditRouter = Router();

const AUDIT_READ_PERMISSION = "auditLog:read";

const auditQuerySchema = z.object({
  actor: z.string().optional(),
  entityType: z.string().optional(),
  action: z.string().optional(),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

/** GET /api/v1/audit — paginated, filterable audit log listing. SUPER_ADMIN and STATE_ADMIN only. */
auditRouter.get("/", authenticate, requirePermission(AUDIT_READ_PERMISSION), (req, res, next) => {
  void (async () => {
    const query = auditQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (query.actor) filter.actorId = query.actor;
    if (query.entityType) filter.entityType = query.entityType;
    if (query.action) filter.action = query.action;
    if (query.severity) filter.severity = query.severity;
    if (query.from ?? query.to) {
      filter.timestamp = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }

    const skip = (query.page - 1) * query.pageSize;
    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ seq: -1 }).skip(skip).limit(query.pageSize).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.status(200).json({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    });
  })().catch(next);
});

/** GET /api/v1/audit/verify-chain — walks the hash chain and reports the first broken link, if any. */
auditRouter.get(
  "/verify-chain",
  authenticate,
  requirePermission(AUDIT_READ_PERMISSION),
  (req, res, next) => {
    void verifyAuditChain()
      .then((result) => res.status(200).json(result))
      .catch(next);
  },
);
