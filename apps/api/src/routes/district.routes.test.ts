import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { User } from "../models/User";
import { hashPassword } from "../lib/password";
import { signAccessToken } from "../lib/tokens";

const app = createApp();

async function seedDistrict(lgdCode: string, name: string) {
  return District.create({
    lgdCode,
    name,
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

async function tokenForRole(
  role: "SUPER_ADMIN" | "DISTRICT_OFFICER",
  districtId?: Types.ObjectId,
): Promise<string> {
  const user = await User.create({
    name: `Test ${role}`,
    email: `${role.toLowerCase()}-${new Types.ObjectId().toString()}@prahari.gov.in`,
    passwordHash: await hashPassword("SomePassw0rd!23"),
    role,
    scope: districtId ? { districtId } : {},
    isActive: true,
  });
  return signAccessToken(user).token;
}

describe("district routes integration", () => {
  it("GET /districts lists every district for SUPER_ADMIN", async () => {
    await seedDistrict("DIST-RT-001", "Alpha District");
    await seedDistrict("DIST-RT-002", "Beta District");
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app).get("/api/v1/districts").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it("scopes a DISTRICT_OFFICER to only their own district", async () => {
    const own = await seedDistrict("DIST-RT-003", "Gamma District");
    await seedDistrict("DIST-RT-004", "Delta District");
    const token = await tokenForRole("DISTRICT_OFFICER", own._id as Types.ObjectId);

    const res = await request(app).get("/api/v1/districts").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]._id).toBe((own._id as Types.ObjectId).toString());
  });
});
