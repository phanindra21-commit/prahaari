import { Schema, model, type Document, type Types } from "mongoose";
import { DECISION_ACTIONS, DECISION_LEVELS } from "@punarvas/shared";
import type { DecisionAction, DecisionLevel } from "@punarvas/shared";

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
  /** Denormalized from Recommendation at decision time — same
   * requireScope()-without-a-$lookup reasoning as Recommendation.districtId. */
  districtId: Types.ObjectId;
  officerId: Types.ObjectId;
  action: DecisionAction;
  /** DISTRICT for every DISTRICT_OFFICER/SUPER_ADMIN action (an ESCALATE
   * included); STATE only for a STATE_ADMIN's decision on a recommendation
   * a district officer escalated — see docs/SECURITY.md's escalation
   * section. Derived from the actor's role at decision time, not supplied
   * by the client. */
  decisionLevel: DecisionLevel;
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
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    officerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, enum: DECISION_ACTIONS, required: true },
    decisionLevel: { type: String, enum: DECISION_LEVELS, required: true },
    justification: { type: String, required: true, minlength: 30, trim: true },
    overriddenFields: { type: [overriddenFieldSchema], required: true, default: [] },
    decidedAt: { type: Date, required: true },
    ipAddress: { type: String, required: true },
  },
  { timestamps: true },
);

decisionSchema.index({ recommendationId: 1 });
decisionSchema.index({ officerId: 1, decidedAt: -1 });
decisionSchema.index({ districtId: 1, decidedAt: -1 });

export const Decision = model<DecisionDoc>("Decision", decisionSchema, "decisions");
