import { Schema, model, type Document, type Types } from "mongoose";
import { JOB_STATUSES, JOB_TYPES } from "@punarvas/shared";
import type { JobStatus, JobType } from "@punarvas/shared";

export interface JobDoc extends Document {
  type: JobType;
  /**
   * A real, correctly-typed ObjectId field — not just the districtId
   * that also lives inside `params` for the worker to read — so
   * `requireScope()`'s default `districtField: "districtId"` behavior
   * (which compares against `Types.ObjectId` values, including a
   * STATE_ADMIN's `$in: [ObjectId, ...]`) works unmodified. Comparing
   * scope against a Mixed/string-typed `params.districtId` path instead
   * would silently fail to match STATE_ADMIN's ObjectId-array scope
   * filter (BSON string vs ObjectId are never equal), which is exactly
   * the kind of scoping bug CLAUDE.md's Auth Conventions warn about.
   */
  districtId: Types.ObjectId;
  status: JobStatus;
  progressPercent: number;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdBy: Types.ObjectId;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<JobDoc>(
  {
    type: { type: String, enum: JOB_TYPES, required: true },
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    status: { type: String, enum: JOB_STATUSES, required: true, default: "PENDING" },
    progressPercent: { type: Number, required: true, min: 0, max: 100, default: 0 },
    params: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

jobSchema.index({ districtId: 1, type: 1, createdAt: -1 });

export const Job = model<JobDoc>("Job", jobSchema, "jobs");
