import { Schema, model, type Document, type Types } from "mongoose";

const APPEND_ONLY_ERROR =
  "AuditLog records are append-only: update and delete operations are not permitted on this collection.";

function blockMutation(next: (err?: Error) => void): void {
  next(new Error(APPEND_ONLY_ERROR));
}

/** Append-only. Every officer/system action that changes state is recorded here and never modified afterward. */
export interface AuditLogDoc extends Document {
  actorId: Types.ObjectId;
  action: string;
  entityType: string;
  entityId: Types.ObjectId;
  before: unknown;
  after: unknown;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    timestamp: { type: Date, required: true, default: () => new Date() },
    ipAddress: { type: String, required: true },
    userAgent: { type: String, required: true },
  },
  { timestamps: true },
);

auditLogSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });
auditLogSchema.index({ actorId: 1, timestamp: -1 });

// Append-only enforcement: block every mutation path except insert.
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
auditLogSchema.pre("deleteOne", { document: false, query: true }, function (next) {
  blockMutation(next);
});
auditLogSchema.pre("deleteMany", { document: false, query: true }, function (next) {
  blockMutation(next);
});
auditLogSchema.pre("findOneAndDelete", function (next) {
  blockMutation(next);
});

export const AuditLog = model<AuditLogDoc>("AuditLog", auditLogSchema, "auditLogs");
