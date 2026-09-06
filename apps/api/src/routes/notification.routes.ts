import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { authenticate } from "../middleware/authenticate";
import { requirePermission } from "../middleware/requirePermission";
import { Notification } from "../models/Notification";

export const notificationRouter = Router();

const NOTIFICATION_READ = "notification:read";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const listQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

/**
 * GET /api/v1/notifications — the caller's OWN notifications only.
 * Deliberately no districtId/recipientId query param, unlike every other
 * list route in this app: notifications aren't a district-scoped resource
 * a caller can be granted broader access to, they're personal — the
 * filter is always `recipientId: req.auth.userId`, hardcoded from the
 * verified token, not user input. No requireScope() for the same reason
 * (there is no district-based row-level access question here).
 */
notificationRouter.get("/notifications", authenticate, requirePermission(NOTIFICATION_READ), (req, res, next) => {
  void (async () => {
    const query = listQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { recipientId: req.auth!.userId };
    if (query.unreadOnly) filter.read = false;

    const [items, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(query.limit),
      Notification.countDocuments({ recipientId: req.auth!.userId, read: false }),
    ]);

    res.status(200).json({ items, unreadCount });
  })().catch(next);
});

/** PATCH /api/v1/notifications/:id/read — marks one of the caller's OWN notifications read. */
notificationRouter.patch(
  "/notifications/:id/read",
  authenticate,
  requirePermission(NOTIFICATION_READ),
  (req, res, next) => {
    void (async () => {
      const parsedId = objectIdString.safeParse(req.params.id);
      if (!parsedId.success) {
        res.status(400).json({ error: "Invalid notification id" });
        return;
      }
      const notification = await Notification.findOneAndUpdate(
        { _id: new Types.ObjectId(parsedId.data), recipientId: req.auth!.userId },
        { $set: { read: true } },
        { new: true },
      );
      if (!notification) {
        res.status(404).json({ error: "Notification not found" });
        return;
      }
      res.status(200).json(notification);
    })().catch(next);
  },
);

/** POST /api/v1/notifications/read-all — marks every one of the caller's unread notifications read. */
notificationRouter.post(
  "/notifications/read-all",
  authenticate,
  requirePermission(NOTIFICATION_READ),
  (req, res, next) => {
    void (async () => {
      const result = await Notification.updateMany(
        { recipientId: req.auth!.userId, read: false },
        { $set: { read: true } },
      );
      res.status(200).json({ modifiedCount: result.modifiedCount });
    })().catch(next);
  },
);
