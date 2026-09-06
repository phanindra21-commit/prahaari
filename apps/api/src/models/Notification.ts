import { Schema, model, type Document, type Types } from "mongoose";
import { NOTIFICATION_TYPES } from "@punarvas/shared";
import type { NotificationType } from "@punarvas/shared";

/**
 * In-app notification (Step 10 Part 6). Always read/written scoped to the
 * current user's own recipientId — no route accepts an arbitrary
 * recipientId, so there is no district-based requireScope() here; ownership
 * (recipientId === req.auth.userId) is the scope, checked directly in
 * notification.routes.ts.
 */
export interface NotificationDoc extends Document {
  recipientId: Types.ObjectId;
  type: NotificationType;
  message: string;
  relatedEntityType: "recommendation";
  relatedEntityId: Types.ObjectId;
  /** Denormalized from the triggering Decision/Recommendation — lets a
   * future district-scoped admin view filter without a $lookup, and is
   * asserted against in tests to guard against cross-district leakage. */
  districtId: Types.ObjectId;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    message: { type: String, required: true, trim: true },
    relatedEntityType: { type: String, enum: ["recommendation"], required: true },
    relatedEntityId: { type: Schema.Types.ObjectId, required: true },
    districtId: { type: Schema.Types.ObjectId, ref: "District", required: true },
    read: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, read: 1 });

export const Notification = model<NotificationDoc>("Notification", notificationSchema, "notifications");
