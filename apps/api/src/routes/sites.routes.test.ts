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

const RAW_ATTRIBUTES = {
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
};

async function seedDistrict(lgdCode: string) {
  return District.create({
    lgdCode,
    name: "Test District",
    state: "Kerala",
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

async function seedScoredSite(districtId: Types.ObjectId, name: string, opts: { excluded?: boolean } = {}) {
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
    rawAttributes: RAW_ATTRIBUTES,
    exclusionsPassed: opts.excluded ? [] : ["insideRedOrOrangeZone"],
    exclusionsFailed: opts.excluded ? ["insideRedOrOrangeZone"] : [],
    suitabilitySubScores: opts.excluded ? new Map() : new Map([["hazardSafety", 0.9]]),
    overallSuitabilityScore: opts.excluded ? null : 0.75,
    carryingCapacity: opts.excluded
      ? null
      : {
          byLand: 300,
          byWater: 200,
          byEducation: 150,
          byHealth: 400,
          byAccess: 250,
          effectiveCapacity: 150,
          bindingConstraint: "EDUCATION",
        },
    scoredAt: opts.excluded ? null : new Date(),
    modelVersion: opts.excluded ? null : "sites-v1-test",
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

describe("sites routes integration", () => {
  it("GET /sites lists scored and excluded sites for a district, sorted by score descending", async () => {
    const district = await seedDistrict("SITES-RT-001");
    await seedScoredSite(district._id as Types.ObjectId, "Excluded Site", { excluded: true });
    await seedScoredSite(district._id as Types.ObjectId, "Good Site");
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .get("/api/v1/sites")
      .query({ districtId: (district._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].name).toBe("Good Site");
    expect(res.body.items[0].overallSuitabilityScore).toBe(0.75);
    expect(res.body.items[1].name).toBe("Excluded Site");
    expect(res.body.items[1].overallSuitabilityScore).toBeNull();
  });

  it("GET /sites?excluded=true filters to only excluded sites", async () => {
    const district = await seedDistrict("SITES-RT-002");
    await seedScoredSite(district._id as Types.ObjectId, "Excluded Site", { excluded: true });
    await seedScoredSite(district._id as Types.ObjectId, "Good Site");
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .get("/api/v1/sites")
      .query({ districtId: (district._id as Types.ObjectId).toString(), excluded: "true" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe("Excluded Site");
  });

  it("GET /sites/:id returns a single site's full scoring detail", async () => {
    const district = await seedDistrict("SITES-RT-003");
    const site = await seedScoredSite(district._id as Types.ObjectId, "Good Site");
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .get(`/api/v1/sites/${(site._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Good Site");
    expect(res.body.carryingCapacity.bindingConstraint).toBe("EDUCATION");
  });

  it("scopes a DISTRICT_OFFICER out of another district's site detail", async () => {
    const own = await seedDistrict("SITES-RT-004A");
    const other = await seedDistrict("SITES-RT-004B");
    const site = await seedScoredSite(other._id as Types.ObjectId, "Other District Site");
    const token = await tokenForRole("DISTRICT_OFFICER", own._id as Types.ObjectId);

    const res = await request(app)
      .get(`/api/v1/sites/${(site._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
