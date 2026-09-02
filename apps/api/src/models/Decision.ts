import { Schema, model, type Document, type Types } from "mongoose";
import { DECISION_ACTIONS } from "@punarvas/shared";
import type { DecisionAction } from "@punarvas/shared";

export interface OverriddenField {
  field: string;
  fromValue: unknown;
  toValue: unknown;
}

/**
 * The human-in-the-loop record: an officer's approval or override of a
 * Recommendation. `justification` is mandatory (min 30 chars) — this is a
 * product requirement (CLAUDE.md: "Officer actions are never silent"),
 * enforced here as defense-in-depth in addition to the Zod schema
 * (packages/shared/src/schemas/decision.ts) that validates it at the API
 * boundary.
 */
export interface DecisionDoc extends Document {
  recommendationId: Types.ObjectId;
  officerId: Types.ObjectId;
  action: DecisionAction;
  justification: string;
  overriddenFields: OverriddenField[];
  decidedAt: Date;
  ipAddress: string;
  createdAt: Date;
  updatedAt: Date;
}

const overriddenFieldSchema = new Schema<OverriddenField>(
  {
    field: { type: String, required: true },
    fromValue: { type: Schema.Types.Mixed },
    toValue: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const decisionSchema = new Schema<DecisionDoc>(
  {
    recommendationId: { type: Schema.Types.ObjectId, ref: "Recommendation", required: true },
    officerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, enum: DECISION_ACTIONS, required: true },
    justification: { type: String, required: true, minlength: 30, trim: true },
    overriddenFields: { type: [overriddenFieldSchema], required: true, default: [] },
    decidedAt: { type: Date, required: true },
    ipAddress: { type: String, required: true },
  },
  { timestamps: true },
);

decisionSchema.index({ recommendationId: 1 });
decisionSchema.index({ officerId: 1, decidedAt: -1 });

export const Decision = model<DecisionDoc>("Decision", decisionSchema, "decisions");
