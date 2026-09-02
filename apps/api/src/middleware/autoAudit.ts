import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { audit } from "../lib/audit";

export interface AuditEntityLocals {
  entityType?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

function toObjectId(value: string | null | undefined): Types.ObjectId | null {
  if (!value || !Types.ObjectId.isValid(value)) {
    return null;
  }
  return new Types.ObjectId(value);
}

const NON_MUTATING_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Auto-audits every successful (2xx) non-GET request under /api/v1/**.
 * A route that already wrote its own, more specific audit entry (e.g.
 * login) sets `res.locals.auditHandled = true` to suppress this generic
 * one; a route can enrich the generic entry instead by setting
 * `res.locals.auditEntity = { entityType, entityId, before, after }`
 * before responding.
 */
export const autoAudit: RequestHandler = (req, res, next) => {
  const isApiV1 = req.path.startsWith("/api/v1");
  const isMutating = !NON_MUTATING_METHODS.has(req.method);

  if (!isApiV1 || !isMutating) {
    next();
    return;
  }

  res.on("finish", () => {
    if (res.locals.auditHandled === true) {
      return;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return;
    }

    const entity = res.locals.auditEntity as AuditEntityLocals | undefined;
    const actor = req.auth;
    const pathSegments = req.path.split("/").filter(Boolean);
    const fallbackEntityType = pathSegments[2] ?? "unknown";

    audit({
      actorId: actor ? actor.userId : null,
      actorLabel: actor ? actor.userId.toString() : "anonymous",
      action: `HTTP ${req.method} ${req.path}`,
      entityType: entity?.entityType ?? fallbackEntityType,
      entityId: toObjectId(entity?.entityId),
      before: entity?.before ?? null,
      after: entity?.after ?? null,
      requestId: req.requestId,
      ipAddress: req.ip ?? "unknown",
      userAgent: req.header("User-Agent") ?? "unknown",
      severity: "INFO",
    }).catch((err: unknown) => {
      console.error("[autoAudit] failed to write audit entry", err);
    });
  });

  next();
};
