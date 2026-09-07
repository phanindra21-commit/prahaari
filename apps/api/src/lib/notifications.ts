import { Types } from "mongoose";
import type { DecisionAction, DecisionLevel } from "@punarvas/shared";
import { User } from "../models/User";
import { Notification } from "../models/Notification";

const ACTION_LABEL: Record<Exclude<DecisionAction, "ESCALATE">, string> = {
  APPROVE: "approved",
  MODIFY: "modified",
  REJECT: "rejected",
  DEFER: "deferred",
};

interface NotifyOnDecisionInput {
  action: Exclude<DecisionAction, "ESCALATE">;
  decisionLevel: DecisionLevel;
  officerId: Types.ObjectId;
  officerName: string;
  districtId: Types.ObjectId;
  districtName: string;
  districtState: string;
  habitationName: string;
  recommendationId: Types.ObjectId;
  /** The district officer who escalated this recommendation, if any —
   * explicitly notified when `decisionLevel` is "STATE" (point 8: "a
   * state-level decision notifies the originating DISTRICT_OFFICER"),
   * in addition to (deduped against) every DISTRICT_OFFICER in the
   * district the generic scan below already includes. */
  escalatedByUserId?: Types.ObjectId | null;
}

/**
 * Step 10 Part 6: notifies everyone with a legitimate interest in a
 * decision, in the specified order — STATE_ADMIN (that state), then
 * DISTRICT_OFFICER (that district), then ANALYST "in scope" (both a
 * district-level analyst scoped to this district AND a state-level
 * analyst scoped to this state, since both are genuinely in scope of a
 * district decision). The deciding officer is never notified about their
 * own action.
 *
 * FIELD_VOLUNTEER is deliberately NOT notified: every message here names
 * the habitation, the action, and the deciding officer — recommendation/
 * decision detail this role does not hold recommendation:read/
 * decision:read for (Part 4B is the same boundary, enforced there for
 * reports). A generic "something happened in your district" notification
 * carrying zero of that detail was considered and rejected as noise with
 * no field-relevant action attached to it — omitting is more honest than
 * manufacturing a vague message.
 */
export async function notifyOnDecision(input: NotifyOnDecisionInput): Promise<void> {
  const {
    action,
    decisionLevel,
    officerId,
    officerName,
    districtId,
    districtName,
    districtState,
    habitationName,
    recommendationId,
    escalatedByUserId,
  } = input;

  const levelPhrase = decisionLevel === "STATE" ? " (state-level)" : "";
  const message = `${habitationName} (${districtName}, ${districtState}): recommendation ${ACTION_LABEL[action]} by ${officerName}${levelPhrase}.`;

  const [stateAdmins, districtOfficers, analysts] = await Promise.all([
    User.find({ role: "STATE_ADMIN", "scope.state": districtState, isActive: true }, { _id: 1 }).lean(),
    User.find({ role: "DISTRICT_OFFICER", "scope.districtId": districtId, isActive: true }, { _id: 1 }).lean(),
    User.find(
      {
        role: "ANALYST",
        isActive: true,
        $or: [{ "scope.districtId": districtId }, { "scope.state": districtState, "scope.districtId": { $exists: false } }],
      },
      { _id: 1 },
    ).lean(),
  ]);

  const explicitRecipients = decisionLevel === "STATE" && escalatedByUserId ? [{ _id: escalatedByUserId }] : [];

  const recipientIds = [...stateAdmins, ...districtOfficers, ...analysts, ...explicitRecipients]
    .map((u) => u._id as Types.ObjectId)
    .filter((id) => !id.equals(officerId));
  const uniqueRecipientIds = [...new Map(recipientIds.map((id) => [id.toString(), id])).values()];

  if (uniqueRecipientIds.length === 0) return;

  await Notification.insertMany(
    uniqueRecipientIds.map((recipientId) => ({
      recipientId,
      type: "DECISION_RECORDED" as const,
      message,
      relatedEntityType: "recommendation" as const,
      relatedEntityId: recommendationId,
      districtId,
      read: false,
    })),
  );
}

interface NotifyOnEscalationInput {
  officerId: Types.ObjectId;
  officerName: string;
  districtId: Types.ObjectId;
  districtName: string;
  districtState: string;
  habitationName: string;
  recommendationId: Types.ObjectId;
}

/**
 * Escalation notification (point 8): notifies every STATE_ADMIN for the
 * escalating district's state — nobody else. Unlike notifyOnDecision this
 * deliberately does not also notify other district officers or analysts:
 * an escalation is a request for state-level action, and the state admin
 * is the only role that gains anything actionable from being told about it.
 * Best-effort, same as notifyOnDecision — a notification failure must never
 * block the ESCALATE decision itself from having been recorded.
 */
export async function notifyOnEscalation(input: NotifyOnEscalationInput): Promise<void> {
  const { officerId, officerName, districtId, districtName, districtState, habitationName, recommendationId } =
    input;

  const message = `${habitationName} (${districtName}, ${districtState}): recommendation escalated to State by ${officerName}.`;

  const stateAdmins = await User.find(
    { role: "STATE_ADMIN", "scope.state": districtState, isActive: true },
    { _id: 1 },
  ).lean();
  const recipientIds = stateAdmins.map((u) => u._id as Types.ObjectId).filter((id) => !id.equals(officerId));

  if (recipientIds.length === 0) return;

  await Notification.insertMany(
    recipientIds.map((recipientId) => ({
      recipientId,
      type: "RECOMMENDATION_ESCALATED" as const,
      message,
      relatedEntityType: "recommendation" as const,
      relatedEntityId: recommendationId,
      districtId,
      read: false,
    })),
  );
}
