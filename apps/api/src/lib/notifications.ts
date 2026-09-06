import { Types } from "mongoose";
import type { DecisionAction } from "@punarvas/shared";
import { User } from "../models/User";
import { Notification } from "../models/Notification";

const ACTION_LABEL: Record<DecisionAction, string> = {
  APPROVE: "approved",
  MODIFY: "modified",
  REJECT: "rejected",
  DEFER: "deferred",
};

interface NotifyOnDecisionInput {
  action: DecisionAction;
  officerId: Types.ObjectId;
  officerName: string;
  districtId: Types.ObjectId;
  districtName: string;
  districtState: string;
  habitationName: string;
  recommendationId: Types.ObjectId;
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
    officerId,
    officerName,
    districtId,
    districtName,
    districtState,
    habitationName,
    recommendationId,
  } = input;

  const message = `${habitationName} (${districtName}, ${districtState}): recommendation ${ACTION_LABEL[action]} by ${officerName}.`;

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

  const recipientIds = [...stateAdmins, ...districtOfficers, ...analysts]
    .map((u) => u._id as Types.ObjectId)
    .filter((id) => !id.equals(officerId));

  if (recipientIds.length === 0) return;

  await Notification.insertMany(
    recipientIds.map((recipientId) => ({
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
