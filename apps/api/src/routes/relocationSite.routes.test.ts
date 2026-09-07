import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { RelocationSite } from "../models/RelocationSite";
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

async function seedSite(districtId: Types.ObjectId, name: string) {
  return RelocationSite.create({
    districtId,
    name,
    geometry: {
      type: "Polygon",
      coordinates: [[[76.05, 11.65], [76.06, 11.65], [76.06, 11.66], [76.05, 11.66], [76.05, 11.65]]],
    },
    centroid: { type: "Point", coordinates: [76.055, 11.655] },
    areaSqm: 50000,
    landOwnership: "GOVT",
    rawAttributes: {
      slopeDegrees: 5,
      inCrzI: false,
      inProtectedForest: false,
      inFloodplain100yr: false,
      distanceToActiveFaultM: 5000,
      distanceToWaterBodyM: 300,
      inMiningLease: false,
      distanceToAllWeatherRoadM: 200,
      availableWaterSupplyLpd: 45000,
      nearbySchoolSpareCapacitySeats: 120,
      nearbyHealthFacilitySpareCapacityPopulation: 1800,
      existingInfrastructureIndex: 0.5,
    },
    dataProvenance: "SYNTHETIC_DEMO",
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

describe("relocation site routes integration", () => {
  it("GET /relocation-sites lists sites for the requested district", async () => {
    const district = await seedDistrict("SITE-RT-001");
    await seedSite(district._id as Types.ObjectId, "Candidate A");
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .get("/api/v1/relocation-sites")
      .query({ districtId: (district._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe("Candidate A");
  });

  it("scopes a DISTRICT_OFFICER out of another district's sites", async () => {
    const own = await seedDistrict("SITE-RT-002A");
    const other = await seedDistrict("SITE-RT-002B");
    await seedSite(other._id as Types.ObjectId, "Other Candidate");
    const token = await tokenForRole("DISTRICT_OFFICER", own._id as Types.ObjectId);

    const res = await request(app)
      .get("/api/v1/relocation-sites")
      .query({ districtId: (other._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
