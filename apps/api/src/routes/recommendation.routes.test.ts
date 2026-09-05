import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { Habitation } from "../models/Habitation";
import { RelocationSite } from "../models/RelocationSite";
import { Recommendation } from "../models/Recommendation";
import { User } from "../models/User";
import { hashPassword } from "../lib/password";
import { signAccessToken } from "../lib/tokens";

const app = createApp();

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

async function seedHabitation(districtId: Types.ObjectId, lgdHabitationCode: string) {
  return Habitation.create({
    lgdHabitationCode,
    name: "Test Habitation",
    block: "Test Block",
    panchayat: "Test Panchayat",
    districtId,
    centroid: { type: "Point", coordinates: [76.05, 11.65] },
    population: 500,
    households: 100,
    demographics: {
      shareUnder5: 0.1, shareSchoolAge6to14: 0.18, shareOver60: 0.1, womenHeadedHouseholdShare: 0.1,
      disabledPersonsShare: 0.05, bplShare: 0.3, scStShare: 0.2, literacyRate: 0.7,
    },
    structures: { kutchaHousingShare: 0.2, avgBuildingAgeYears: 20, predominantFoundationType: "STONE_MASONRY" },
    access: { distanceToAllWeatherRoadKm: 2, distanceToPhcKm: 5, mobileNetworkCoverage: 0.6, evacuationRouteCount: 1 },
    livelihood: { primaryOccupation: "AGRICULTURE", distanceToLivelihoodAssetKm: 1, primaryLivelihoodDependenceShare: 0.5 },
    copingCapacity: { sdrfResponseTimeMinutes: 60, shelterWithin2km: true, communityTaskForcePresent: false, earlyWarningCoverage: 0.5 },
    consentStatus: "NOT_ENGAGED",
    dataProvenance: "SYNTHETIC_DEMO",
  });
}

async function seedSite(districtId: Types.ObjectId) {
  return RelocationSite.create({
    districtId,
    name: "Test Candidate Site",
    geometry: {
      type: "Polygon",
      coordinates: [[[76.08, 11.68], [76.09, 11.68], [76.09, 11.69], [76.08, 11.69], [76.08, 11.68]]],
    },
    centroid: { type: "Point", coordinates: [76.085, 11.685] },
    areaSqm: 50000,
    landOwnership: "GOVT",
    rawAttributes: {
      slopeDegrees: 5, inCrzI: false, inProtectedForest: false, inFloodplain100yr: false,
      distanceToActiveFaultM: 5000, distanceToWaterBodyM: 300, inMiningLease: false,
      distanceToAllWeatherRoadM: 200, availableWaterSupplyLpd: 45000,
      nearbySchoolSpareCapacitySeats: 120, nearbyHealthFacilitySpareCapacityPopulation: 1800,
      existingInfrastructureIndex: 0.5,
    },
    dataProvenance: "SYNTHETIC_DEMO",
  });
}

async function seedRecommendation(
  districtId: Types.ObjectId,
  habitationId: Types.ObjectId,
  siteId: Types.ObjectId,
  priorityBucket: "Immediate" | "ShortTerm" | "MediumTerm" = "Immediate",
) {
  return Recommendation.create({
    habitationId,
    districtId,
    candidateSites: [{ relocationSiteId: siteId, rank: 1, suitabilityScore: 0.8 }],
    priorityBucket,
    estimatedHouseholdsToMove: 100,
    phasing: [{ phase: 1, householdCount: 100, targetDate: new Date() }],
    rationale: "Test rationale for this recommendation.",
    modelVersion: "sites-v1-test",
    status: "PENDING_REVIEW",
    generatedAt: new Date(),
  });
}

async function tokenForRole(
  role: "SUPER_ADMIN" | "DISTRICT_OFFICER" | "FIELD_VOLUNTEER",
  districtId?: Types.ObjectId,
): Promise<string> {
  const user = await User.create({
    name: `Test ${role}`,
    email: `${role.toLowerCase()}-${new Types.ObjectId().toString()}@punarvas.gov.in`,
    passwordHash: await hashPassword("SomePassw0rd!23"),
    role,
    scope: districtId ? { districtId } : {},
    isActive: true,
  });
  return signAccessToken(user).token;
}

describe("recommendation routes integration", () => {
  it("GET /recommendations lists recommendations for SUPER_ADMIN across districts", async () => {
    const district = await seedDistrict("REC-RT-001");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "REC-RT-001-H1");
    const site = await seedSite(district._id as Types.ObjectId);
    await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app).get("/api/v1/recommendations").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].priorityBucket).toBe("Immediate");
    expect(res.body.items[0].status).toBe("PENDING_REVIEW");
  });

  it("filters by priorityBucket and status", async () => {
    const district = await seedDistrict("REC-RT-002");
    const habitationA = await seedHabitation(district._id as Types.ObjectId, "REC-RT-002-H1");
    const habitationB = await seedHabitation(district._id as Types.ObjectId, "REC-RT-002-H2");
    const site = await seedSite(district._id as Types.ObjectId);
    await seedRecommendation(
      district._id as Types.ObjectId,
      habitationA._id as Types.ObjectId,
      site._id as Types.ObjectId,
      "Immediate",
    );
    await seedRecommendation(
      district._id as Types.ObjectId,
      habitationB._id as Types.ObjectId,
      site._id as Types.ObjectId,
      "ShortTerm",
    );
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .get("/api/v1/recommendations")
      .query({ priorityBucket: "ShortTerm" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].priorityBucket).toBe("ShortTerm");
  });

  it("GET /recommendations/:id returns a single recommendation's full detail", async () => {
    const district = await seedDistrict("REC-RT-003");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "REC-RT-003-H1");
    const site = await seedSite(district._id as Types.ObjectId);
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .get(`/api/v1/recommendations/${(recommendation._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.rationale).toBe("Test rationale for this recommendation.");
    expect(res.body.candidateSites).toHaveLength(1);
  });

  it("scopes a DISTRICT_OFFICER out of another district's recommendations", async () => {
    const own = await seedDistrict("REC-RT-004A");
    const other = await seedDistrict("REC-RT-004B");
    const habitation = await seedHabitation(other._id as Types.ObjectId, "REC-RT-004-H1");
    const site = await seedSite(other._id as Types.ObjectId);
    const recommendation = await seedRecommendation(
      other._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("DISTRICT_OFFICER", own._id as Types.ObjectId);

    const listRes = await request(app).get("/api/v1/recommendations").set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(0);

    const detailRes = await request(app)
      .get(`/api/v1/recommendations/${(recommendation._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detailRes.status).toBe(404);
  });

  it("SECURITY: an explicit ?districtId= for another district is rejected (404), not silently substituted for the caller's own scope", async () => {
    // Regression test: this route used to build its filter as
    // `{ ...req.scopeFilter, districtId: <query value> }` — the explicit
    // query value unconditionally OVERWROTE the scope-derived districtId,
    // so any single-district role could read ANY other district's
    // recommendations just by passing its id. Verified exploitable live
    // before this fix (a Wayanad DISTRICT_OFFICER token successfully
    // listed Ganjam's recommendations).
    const own = await seedDistrict("REC-RT-005A");
    const other = await seedDistrict("REC-RT-005B");
    const habitation = await seedHabitation(other._id as Types.ObjectId, "REC-RT-005-H1");
    const site = await seedSite(other._id as Types.ObjectId);
    await seedRecommendation(other._id as Types.ObjectId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
    const token = await tokenForRole("DISTRICT_OFFICER", own._id as Types.ObjectId);

    const res = await request(app)
      .get(`/api/v1/recommendations?districtId=${(other._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("rejects a role without recommendation:read", async () => {
    const token = await tokenForRole("FIELD_VOLUNTEER");
    const res = await request(app).get("/api/v1/recommendations").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
