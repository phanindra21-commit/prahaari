import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { Notification } from "../models/Notification";
import { User } from "../models/User";
import { hashPassword } from "../lib/password";
import { signAccessToken } from "../lib/tokens";

const app = createApp();

async function seedDistrict(lgdCode: string) {
  return District.create({
    lgdCode,
    name: "Test District",
    state: "Testland",
    boundary: {
      type: "Polygon",
      coordinates: [[[76.0, 11.6], [76.2, 11.6], [76.2, 11.8], [76.0, 11.8], [76.0, 11.6]]],
    },
    population: 1000,
    areaSqKm: 100,
    primaryHazards: ["landslide"],
    dmAuthorityContact: { name: "Test", designation: "Tester", phone: "0000000000" },
  });
}

async function makeUser(role: "DISTRICT_OFFICER" | "FIELD_VOLUNTEER", districtId: Types.ObjectId) {
  return User.create({
    name: `Test ${role}`,
    email: `${role.toLowerCase()}-${new Types.ObjectId().toString()}@punarvas.gov.in`,
    passwordHash: await hashPassword("SomePassw0rd!23"),
    role,
    scope: { districtId },
    isActive: true,
  });
}

async function seedNotification(recipientId: Types.ObjectId, districtId: Types.ObjectId, read = false) {
  return Notification.create({
    recipientId,
    type: "DECISION_RECORDED",
    message: "Test Habitation (Test District, Testland): recommendation approved by Test Officer.",
    relatedEntityType: "recommendation",
    relatedEntityId: new Types.ObjectId(),
    districtId,
    read,
  });
}

describe("notification routes integration (Step 10 Part 6)", () => {
  it("GET /notifications returns only the caller's own notifications and the correct unread count", async () => {
    const district = await seedDistrict("NOT-RT-001");
    const districtId = district._id as Types.ObjectId;
    const me = await makeUser("DISTRICT_OFFICER", districtId);
    const someoneElse = await makeUser("DISTRICT_OFFICER", districtId);

    await seedNotification(me._id as Types.ObjectId, districtId, false);
    await seedNotification(me._id as Types.ObjectId, districtId, true);
    await seedNotification(someoneElse._id as Types.ObjectId, districtId, false);

    const token = signAccessToken(me).token;
    const res = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.unreadCount).toBe(1);
    for (const item of res.body.items) {
      expect(item.recipientId).toBe((me._id as Types.ObjectId).toString());
    }
  });

  it("PATCH /notifications/:id/read marks only the caller's own notification, never someone else's", async () => {
    const district = await seedDistrict("NOT-RT-002");
    const districtId = district._id as Types.ObjectId;
    const me = await makeUser("DISTRICT_OFFICER", districtId);
    const someoneElse = await makeUser("DISTRICT_OFFICER", districtId);
    const mine = await seedNotification(me._id as Types.ObjectId, districtId, false);
    const theirs = await seedNotification(someoneElse._id as Types.ObjectId, districtId, false);

    const token = signAccessToken(me).token;

    const ok = await request(app)
      .patch(`/api/v1/notifications/${(mine._id as Types.ObjectId).toString()}/read`)
      .set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.read).toBe(true);

    const forbidden = await request(app)
      .patch(`/api/v1/notifications/${(theirs._id as Types.ObjectId).toString()}/read`)
      .set("Authorization", `Bearer ${token}`);
    expect(forbidden.status).toBe(404);

    const theirsUnchanged = await Notification.findById(theirs._id as Types.ObjectId);
    expect(theirsUnchanged!.read).toBe(false);
  });

  it("POST /notifications/read-all marks every one of the caller's unread notifications, not another user's", async () => {
    const district = await seedDistrict("NOT-RT-003");
    const districtId = district._id as Types.ObjectId;
    const me = await makeUser("DISTRICT_OFFICER", districtId);
    const someoneElse = await makeUser("DISTRICT_OFFICER", districtId);
    await seedNotification(me._id as Types.ObjectId, districtId, false);
    await seedNotification(me._id as Types.ObjectId, districtId, false);
    const theirs = await seedNotification(someoneElse._id as Types.ObjectId, districtId, false);

    const token = signAccessToken(me).token;
    const res = await request(app).post("/api/v1/notifications/read-all").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.modifiedCount).toBe(2);

    const mineNow = await Notification.find({ recipientId: me._id as Types.ObjectId });
    expect(mineNow.every((n) => n.read)).toBe(true);
    const theirsNow = await Notification.findById(theirs._id as Types.ObjectId);
    expect(theirsNow!.read).toBe(false);
  });

  it("FIELD_VOLUNTEER can read their own notifications (notification:read is granted broadly)", async () => {
    const district = await seedDistrict("NOT-RT-004");
    const districtId = district._id as Types.ObjectId;
    const volunteer = await makeUser("FIELD_VOLUNTEER", districtId);
    await seedNotification(volunteer._id as Types.ObjectId, districtId, false);

    const token = signAccessToken(volunteer).token;
    const res = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});
