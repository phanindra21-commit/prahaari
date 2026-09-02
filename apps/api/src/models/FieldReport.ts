import { Schema, model, type Document, type Types } from "mongoose";
import {
  FIELD_REPORT_OBSERVATION_TYPES,
  FIELD_REPORT_VERIFICATION_STATUSES,
} from "@punarvas/shared";
import type {
  FieldReportObservationType,
  FieldReportVerificationStatus,
  GeoPoint,
} from "@punarvas/shared";
import { geoPointSchema } from "./geoSchemas";

/** Lightweight ground-truth observation submitted by a FIELD_VOLUNTEER (RBAC Part C1). */
export interface FieldReportDoc extends Document {
  habitationId: Types.ObjectId;
  observationType: FieldReportObservationType;
  photos: string[];
  notes?: string;
  location: GeoPoint;
  submittedBy: Types.ObjectId;
  verificationStatus: FieldReportVerificationStatus;
  verifiedBy: Types.ObjectId | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const fieldReportSchema = new Schema<FieldReportDoc>(
  {
    habitationId: { type: Schema.Types.ObjectId, ref: "Habitation", required: true },
    observationType: { type: String, enum: FIELD_REPORT_OBSERVATION_TYPES, required: true },
    photos: { type: [String], required: true, default: [] },
    notes: { type: String },
    location: { type: geoPointSchema, required: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    verificationStatus: {
      type: String,
      enum: FIELD_REPORT_VERIFICATION_STATUSES,
      required: true,
      default: "PENDING",
    },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

fieldReportSchema.index({ location: "2dsphere" });
fieldReportSchema.index({ habitationId: 1, createdAt: -1 });
fieldReportSchema.index({ verificationStatus: 1 });

export const FieldReport = model<FieldReportDoc>("FieldReport", fieldReportSchema, "fieldReports");
