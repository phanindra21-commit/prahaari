import { Schema, model, type Document, type Types } from "mongoose";
import type { AnyBulkWriteOperation, mongo } from "mongoose";

const APPEND_ONLY_ERROR =
  "AuditLog records are append-only: update and delete operations are not permitted on this collection.";

function blockMutation(next: (err?: Error) => void): void {
  next(new Error(APPEND_ONLY_ERROR));
}

export type AuditSeverity = "INFO" | "WARNING" | "CRITICAL";
const AUDIT_SEVERITIES: AuditSeverity[] = ["INFO", "WARNING", "CRITICAL"];

/**
 * Append-only, hash-chained audit trail. Every officer/system action that
 * changes state is recorded here and never modified afterward — see the
 * mutation guards below and apps/api/src/lib/audit.ts (which computes
 * `prevHash`/`entryHash` and is the only supported way to write here).
 *
 * `prevHash`/`entryHash` form a single hash chain across this whole
 * collection (`seq` is the chain's monotonic ordering key), so any
 * out-of-band tampering with a stored document (e.g. a direct DB edit
 * that bypasses these Mongoose guards entirely) is detectable by
 * recomputing the chain — see GET /api/v1/audit/verify-chain.
 */
export interface AuditLogDoc extends Document {
  seq: number;
  actorId: Types.ObjectId | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: Types.ObjectId | null;
  before: unknown;
  after: unknown;
  requestId: string;
  ipAddress: string;
  userAgent: string;
  severity: AuditSeverity;
  timestamp: Date;
  prevHash: string;
  entryHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    seq: { type: Number, required: true, unique: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorLabel: { type: String, required: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    requestId: { type: String, required: true },
    ipAddress: { type: String, required: true },
    userAgent: { type: String, required: true },
    severity: { type: String, enum: AUDIT_SEVERITIES, required: true, default: "INFO" },
    timestamp: { type: Date, required: true, default: () => new Date() },
    prevHash: { type: String, required: true },
    entryHash: { type: String, required: true },
  },
  { timestamps: true },
);

auditLogSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });
auditLogSchema.index({ actorId: 1, timestamp: -1 });
auditLogSchema.index({ severity: 1, timestamp: -1 });

// --- Append-only enforcement: block every mutation path except a plain insert. ---
auditLogSchema.pre("save", function (next) {
  if (!this.isNew) {
    blockMutation(next);
    return;
  }
  next();
});
auditLogSchema.pre("updateOne", { document: false, query: true }, function (next) {
  blockMutation(next);
});
auditLogSchema.pre("updateMany", { document: false, query: true }, function (next) {
  blockMutation(next);
});
auditLogSchema.pre("findOneAndUpdate", function (next) {
  blockMutation(next);
});
auditLogSchema.pre("replaceOne", { document: false, query: true }, function (next) {
  blockMutation(next);
});
auditLogSchema.pre("findOneAndReplace", function (next) {
  blockMutation(next);
});
auditLogSchema.pre("deleteOne", { document: false, query: true }, function (next) {
  blockMutation(next);
});
auditLogSchema.pre("deleteMany", { document: false, query: true }, function (next) {
  blockMutation(next);
});
auditLogSchema.pre("findOneAndDelete", function (next) {
  blockMutation(next);
});

const AuditLogModel = model<AuditLogDoc>("AuditLog", auditLogSchema, "auditLogs");

// Mongoose's per-path pre-hooks above do not intercept Model.bulkWrite (it
// talks to the native MongoDB collection directly), so bulkWrite is
// overridden here to reject any operation that is not a plain insertOne.
const originalBulkWrite = AuditLogModel.bulkWrite.bind(AuditLogModel);
AuditLogModel.bulkWrite = (async (
  operations: AnyBulkWriteOperation<AuditLogDoc>[],
  options?: mongo.BulkWriteOptions,
) => {
  const hasNonInsert = operations.some((op) => !("insertOne" in op));
  if (hasNonInsert) {
    throw new Error(APPEND_ONLY_ERROR);
  }
  return originalBulkWrite(operations, options);
}) as typeof AuditLogModel.bulkWrite;

export const AuditLog = AuditLogModel;
