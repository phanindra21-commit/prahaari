import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { HazardEvent } from "../models/HazardEvent";
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

async function seedEvent(districtId: Types.ObjectId, hazardType: string, name: string) {
  return HazardEvent.create({
    districtId,
    hazardType,
    name,
    date: new Date("2024-07-30"),
    extent: { type: "Point", coordinates: [76.1, 11.6] },
    deaths: 10,
    injured: 5,
    displaced: 100,
    housesDamaged: 20,
    economicLossInrLakh: 500,
    source: "NEWS",
    confidence: "HIGH",
    dataProvenance: "PUBLIC_RECORD",
  });
}

async function tokenForRole(role: "SUPER_ADMIN" | "DISTRICT_OFFICER", districtId?: Types.ObjectId): Promise<string> {
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

describe("hazard event routes integration", () => {
  it("GET /hazard-events lists events, filterable by district and hazard type", async () => {
    const district = await seedDistrict("EVT-RT-001");
    await seedEvent(district._id as Types.ObjectId, "landslide", "Test landslide");
    await seedEvent(district._id as Types.ObjectId, "flood", "Test flood");
    const token = await tokenForRole("SUPER_ADMIN");

    const all = await request(app)
      .get("/api/v1/hazard-events")
      .query({ districtId: (district._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(2);

    const filtered = await request(app)
      .get("/api/v1/hazard-events")
      .query({ districtId: (district._id as Types.ObjectId).toString(), hazardType: "landslide" })
      .set("Authorization", `Bearer ${token}`);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].name).toBe("Test landslide");
  });

  it("scopes a DISTRICT_OFFICER: cannot read another district's events, can read their own", async () => {
    const own = await seedDistrict("EVT-RT-002A");
    const other = await seedDistrict("EVT-RT-002B");
    await seedEvent(own._id as Types.ObjectId, "landslide", "Own event");
    await seedEvent(other._id as Types.ObjectId, "landslide", "Other event");
    const token = await tokenForRole("DISTRICT_OFFICER", own._id as Types.ObjectId);

    const ownRes = await request(app)
      .get("/api/v1/hazard-events")
      .query({ districtId: (own._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.items).toHaveLength(1);

    const otherRes = await request(app)
      .get("/api/v1/hazard-events")
      .query({ districtId: (other._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(otherRes.status).toBe(404);
  });
});
