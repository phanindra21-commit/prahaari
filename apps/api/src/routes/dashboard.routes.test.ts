import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { Habitation } from "../models/Habitation";
import { Assessment } from "../models/Assessment";
import { Recommendation } from "../models/Recommendation";
import { Decision } from "../models/Decision";
import { RelocationSite } from "../models/RelocationSite";
import { User } from "../models/User";
import { hashPassword } from "../lib/password";
import { signAccessToken } from "../lib/tokens";

const app = createApp();

async function seedDistrict(lgdCode: string, state = "Kerala") {
  return District.create({
    lgdCode,
    name: `Test District ${lgdCode}`,
    state,
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

async function seedHabitation(districtId: Types.ObjectId, code: string, population = 200, households = 40) {
  return Habitation.create({
    lgdHabitationCode: code,
    name: `Habitation ${code}`,
    block: "Test Block",
    panchayat: "Test Panchayat",
    districtId,
    centroid: { type: "Point", coordinates: [76.05, 11.65] },
    population,
    households,
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

async function seedAssessment(
  districtId: Types.ObjectId,
  habitationId: Types.ObjectId,
  opts: {
    zoneClass?: "Red" | "Orange" | "Yellow" | "Green";
    bucket?: "Immediate" | "ShortTerm" | "MediumTerm" | null;
    rpi?: number | null;
    hazard?: "landslide" | "flood" | "coastalErosion" | "cloudburst";
  } = {},
) {
  const zoneClass = opts.zoneClass ?? "Red";
  const bucket = opts.bucket === undefined ? "Immediate" : opts.bucket;
  const rpi = opts.rpi === undefined ? 0.8 : opts.rpi;
  const hazard = opts.hazard ?? "landslide";
  return Assessment.create({
    habitationId,
    districtId,
    hazardExposure: [{ hazardType: hazard, hazardScore: 0.8, exposure: 0.7, zoneClass, disasterHistoryBoost: 0 }],
    vulnerabilityIndex: 0.5,
    vulnerabilityDimensions: { demographic: 0.5, socioeconomic: 0.5, structural: 0.5, accessibility: 0.5 },
    copingCapacity: 0.3,
    compositeRiskScore: 0.6,
    governingHazard: hazard,
    overallZoneClass: zoneClass,
    relocationPriorityIndex: rpi,
    priorityBucket: bucket,
    modelVersion: "test-v1",
    computedAt: new Date(),
    validFrom: new Date(),
    validTo: null,
    supersedes: null,
    explanation: [],
    compoundHazard: null,
  });
}

async function seedRecommendation(
  districtId: Types.ObjectId,
  habitationId: Types.ObjectId,
  siteId: Types.ObjectId,
  opts: { matched?: boolean; status?: string } = {},
) {
  const matched = opts.matched ?? true;
  return Recommendation.create({
    habitationId,
    districtId,
    candidateSites: [{ relocationSiteId: siteId, rank: 1, suitabilityScore: 0.7 }],
    selectedSiteId: siteId,
    priorityBucket: "Immediate",
    estimatedHouseholdsToMove: 40,
    phasing: matched ? [{ phase: 1, householdCount: 40, targetDate: new Date() }] : [],
    rationale: "Test rationale.",
    modelVersion: "test-v1",
    status: opts.status ?? "PENDING_REVIEW",
    generatedAt: new Date(),
  });
}

async function seedRelocationSite(districtId: Types.ObjectId, bindingConstraint: "EDUCATION" | "WATER" = "EDUCATION") {
  return RelocationSite.create({
    districtId,
    name: "Test Site",
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
    exclusionsPassed: ["insideRedOrOrangeZone"],
    exclusionsFailed: [],
    overallSuitabilityScore: 0.7,
    carryingCapacity: {
      byLand: 300, byWater: 250, byEducation: 100, byHealth: 400, byAccess: 350,
      effectiveCapacity: 100, bindingConstraint,
    },
    scoredAt: new Date(),
    modelVersion: "test-v1",
    dataProvenance: "SYNTHETIC_DEMO",
  });
}

async function tokenForRole(
  role: "SUPER_ADMIN" | "STATE_ADMIN" | "DISTRICT_OFFICER" | "FIELD_VOLUNTEER" | "ANALYST",
  scope: { state?: string; districtId?: Types.ObjectId } = {},
): Promise<string> {
  const user = await User.create({
    name: `Test ${role}`,
    email: `${role.toLowerCase()}-${new Types.ObjectId().toString()}@prahari.gov.in`,
    passwordHash: await hashPassword("SomePassw0rd!23"),
    role,
    scope,
    isActive: true,
  });
  return signAccessToken(user).token;
}

describe("dashboard routes integration", () => {
  it("DISTRICT_OFFICER sees the full dashboard with correct capacity-shortfall arithmetic", async () => {
    const district = await seedDistrict("DASH-RT-001");
    const h1 = await seedHabitation(district._id as Types.ObjectId, "H1", 300, 60);
    const h2 = await seedHabitation(district._id as Types.ObjectId, "H2", 150, 30);
    const h3 = await seedHabitation(district._id as Types.ObjectId, "H3", 500, 100);
    await seedAssessment(district._id as Types.ObjectId, h1._id as Types.ObjectId, {
      zoneClass: "Red",
      bucket: "Immediate",
      rpi: 0.9,
    });
    await seedAssessment(district._id as Types.ObjectId, h2._id as Types.ObjectId, {
      zoneClass: "Orange",
      bucket: "ShortTerm",
      rpi: 0.6,
    });
    await seedAssessment(district._id as Types.ObjectId, h3._id as Types.ObjectId, {
      zoneClass: "Yellow",
      bucket: null,
      rpi: null,
    });
    const site = await seedRelocationSite(district._id as Types.ObjectId, "EDUCATION");
    // h1 matched to a site, h2 not matched — the shortfall is exactly this gap.
    await seedRecommendation(district._id as Types.ObjectId, h1._id as Types.ObjectId, site._id as Types.ObjectId, {
      matched: true,
    });
    await seedRecommendation(district._id as Types.ObjectId, h2._id as Types.ObjectId, site._id as Types.ObjectId, {
      matched: false,
    });
    const token = await tokenForRole("DISTRICT_OFFICER", { state: "Kerala", districtId: district._id as Types.ObjectId });

    const res = await request(app)
      .get(`/api/v1/dashboard/summary?districtId=${(district._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const d = res.body.districts[0];
    expect(d.habitationsAssessed).toBe(3);
    expect(d.redCount).toBe(1);
    expect(d.orangeCount).toBe(1);
    expect(d.bucketCounts).toEqual({ Immediate: 1, ShortTerm: 1, MediumTerm: 0 });
    expect(d.immediatePopulation).toBe(300);
    expect(d.immediateHouseholds).toBe(60);
    // h1 (population 300) is the only Immediate-bucket habitation; shareUnder5/shareOver60 0.1,
    // disabledPersonsShare 0.05 from seedHabitation's fixture demographics.
    expect(d.immediateDemographics).toEqual({ under5: 30, over60: 30, disabled: 15 });
    expect(d.capacityShortfall).toEqual({
      needsRelocation: 2,
      hasViableSite: 1,
      noViableSite: 1,
      populationWithNoSite: 150,
    });
    expect(d.hazardDistribution).toEqual(expect.arrayContaining([{ hazardType: "landslide", count: 3 }]));
    expect(d.bindingConstraintDistribution).toEqual([{ bindingConstraint: "EDUCATION", count: 1 }]);
    expect(d.needsAttention.length).toBe(2);
    expect(d.needsAttention[0].habitationName).toBe("Habitation H1");
    expect(d.needsAttention[0].hasMatchedSite).toBe(true);
    expect(d.needsAttention[1].hasMatchedSite).toBe(false);
    expect(d.pendingDecisions).toBe(2);
    expect(res.body.aggregate).toBeNull();
  });

  it("FIELD_VOLUNTEER sees only base figures — every gated section is null", async () => {
    const district = await seedDistrict("DASH-RT-002");
    const h1 = await seedHabitation(district._id as Types.ObjectId, "H1");
    await seedAssessment(district._id as Types.ObjectId, h1._id as Types.ObjectId, { zoneClass: "Red" });
    const token = await tokenForRole("FIELD_VOLUNTEER", { state: "Kerala", districtId: district._id as Types.ObjectId });

    const res = await request(app)
      .get(`/api/v1/dashboard/summary?districtId=${(district._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const d = res.body.districts[0];
    expect(d.habitationsAssessed).toBe(1);
    expect(d.redCount).toBe(1);
    expect(d.capacityShortfall).toBeNull();
    expect(d.hazardDistribution).toBeNull();
    expect(d.bindingConstraintDistribution).toBeNull();
    expect(d.needsAttention).toBeNull();
    expect(d.recentDecisions).toBeNull();
    expect(d.pendingDecisions).toBeNull();
  });

  it("STATE_ADMIN sees only their state's districts, with a per-district breakdown and a summed aggregate", async () => {
    const kerala = await seedDistrict("DASH-RT-003A", "Kerala");
    const odisha = await seedDistrict("DASH-RT-003B", "Odisha");
    const h1 = await seedHabitation(kerala._id as Types.ObjectId, "H1");
    const h2 = await seedHabitation(odisha._id as Types.ObjectId, "H2");
    await seedAssessment(kerala._id as Types.ObjectId, h1._id as Types.ObjectId, { zoneClass: "Red" });
    await seedAssessment(odisha._id as Types.ObjectId, h2._id as Types.ObjectId, { zoneClass: "Red" });
    const token = await tokenForRole("STATE_ADMIN", { state: "Kerala" });

    const res = await request(app).get("/api/v1/dashboard/summary").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.districts).toHaveLength(1);
    expect(res.body.districts[0].districtName).toBe(kerala.name);
    expect(res.body.aggregate).toBeNull();
  });

  it("returns a summed aggregate when more than one district is in scope", async () => {
    const d1 = await seedDistrict("DASH-RT-004A", "Odisha");
    const d2 = await seedDistrict("DASH-RT-004B", "Odisha");
    const h1 = await seedHabitation(d1._id as Types.ObjectId, "H1", 100, 20);
    const h2 = await seedHabitation(d2._id as Types.ObjectId, "H2", 200, 40);
    await seedAssessment(d1._id as Types.ObjectId, h1._id as Types.ObjectId, { zoneClass: "Red", bucket: "Immediate" });
    await seedAssessment(d2._id as Types.ObjectId, h2._id as Types.ObjectId, { zoneClass: "Orange", bucket: "ShortTerm" });
    const token = await tokenForRole("STATE_ADMIN", { state: "Odisha" });

    const res = await request(app).get("/api/v1/dashboard/summary").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.districts).toHaveLength(2);
    expect(res.body.aggregate.habitationsAssessed).toBe(2);
    expect(res.body.aggregate.redCount).toBe(1);
    expect(res.body.aggregate.orangeCount).toBe(1);
    expect(res.body.aggregate.immediatePopulation).toBe(100);
    // Only d1's h1 (population 100) is Immediate-bucket; d2's h2 is ShortTerm and excluded.
    expect(res.body.aggregate.immediateDemographics).toEqual({ under5: 10, over60: 10, disabled: 5 });
  });

  it("scopes a DISTRICT_OFFICER out of another district's dashboard (404, not a mismatched-filter 200)", async () => {
    const own = await seedDistrict("DASH-RT-005A");
    const other = await seedDistrict("DASH-RT-005B");
    const token = await tokenForRole("DISTRICT_OFFICER", { state: "Kerala", districtId: own._id as Types.ObjectId });

    const res = await request(app)
      .get(`/api/v1/dashboard/summary?districtId=${(other._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("recent decisions are populated for a role with decision:read, sourced from the already-scoped Decision collection", async () => {
    const district = await seedDistrict("DASH-RT-006");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "H1");
    await seedAssessment(district._id as Types.ObjectId, habitation._id as Types.ObjectId, { zoneClass: "Red" });
    const site = await seedRelocationSite(district._id as Types.ObjectId);
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
      { status: "APPROVED" },
    );
    const officer = await User.create({
      name: "Deciding Officer",
      email: `officer-${new Types.ObjectId().toString()}@prahari.gov.in`,
      passwordHash: await hashPassword("SomePassw0rd!23"),
      role: "DISTRICT_OFFICER",
      scope: { state: "Kerala", districtId: district._id },
      isActive: true,
    });
    await Decision.create({
      recommendationId: recommendation._id,
      districtId: district._id,
      officerId: officer._id,
      action: "APPROVE",
      decisionLevel: "DISTRICT",
      justification: "Approved after reviewing suitability and capacity for this habitation.",
      overriddenFields: [],
      decidedAt: new Date(),
      ipAddress: "127.0.0.1",
    });
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .get(`/api/v1/dashboard/summary?districtId=${(district._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const d = res.body.districts[0];
    expect(d.recentDecisions).toHaveLength(1);
    expect(d.recentDecisions[0].officerName).toBe("Deciding Officer");
    expect(d.recentDecisions[0].action).toBe("APPROVE");
  });
});
