import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { Habitation } from "../models/Habitation";
import { RelocationSite } from "../models/RelocationSite";
import { Recommendation } from "../models/Recommendation";
import { AuditLog } from "../models/AuditLog";
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

async function seedSite(districtId: Types.ObjectId, name: string) {
  return RelocationSite.create({
    districtId,
    name,
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
  secondSiteId?: Types.ObjectId,
) {
  const candidateSites = [{ relocationSiteId: siteId, rank: 1, suitabilityScore: 0.8 }];
  if (secondSiteId) {
    candidateSites.push({ relocationSiteId: secondSiteId, rank: 2, suitabilityScore: 0.6 });
  }
  return Recommendation.create({
    habitationId,
    districtId,
    candidateSites,
    selectedSiteId: siteId,
    priorityBucket: "Immediate",
    estimatedHouseholdsToMove: 100,
    phasing: [{ phase: 1, householdCount: 100, targetDate: new Date() }],
    rationale: "Test rationale for this recommendation.",
    modelVersion: "sites-v1-test",
    status: "PENDING_REVIEW",
    generatedAt: new Date(),
  });
}

async function tokenForRole(
  role: "SUPER_ADMIN" | "DISTRICT_OFFICER" | "FIELD_VOLUNTEER" | "STATE_ADMIN",
  districtId?: Types.ObjectId,
  state?: string,
): Promise<string> {
  const user = await User.create({
    name: `Test ${role}`,
    email: `${role.toLowerCase()}-${new Types.ObjectId().toString()}@punarvas.gov.in`,
    passwordHash: await hashPassword("SomePassw0rd!23"),
    role,
    scope: districtId ? { districtId } : state ? { state } : {},
    isActive: true,
  });
  return signAccessToken(user).token;
}

const LONG_JUSTIFICATION = "This site clears every hard exclusion and has enough headroom for this habitation.";

describe("decision routes integration", () => {
  it("APPROVE: creates a Decision, sets Recommendation status, and writes a hash-chained AuditLog entry", async () => {
    const district = await seedDistrict("DEC-RT-001");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "DEC-RT-001-H1");
    const site = await seedSite(district._id as Types.ObjectId, "Site A");
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("DISTRICT_OFFICER", district._id as Types.ObjectId);

    const res = await request(app)
      .post("/api/v1/decisions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "APPROVE",
        justification: LONG_JUSTIFICATION,
      });

    expect(res.status).toBe(201);
    expect(res.body.recommendation.status).toBe("APPROVED");
    expect(res.body.decision.action).toBe("APPROVE");

    const updated = await Recommendation.findById(recommendation._id as Types.ObjectId);
    expect(updated!.status).toBe("APPROVED");

    const auditEntry = await AuditLog.findOne({
      entityType: "decision",
      entityId: res.body.decision._id,
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry!.entryHash).toBeTruthy();
  });

  it("rejects a justification shorter than 30 characters", async () => {
    const district = await seedDistrict("DEC-RT-002");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "DEC-RT-002-H1");
    const site = await seedSite(district._id as Types.ObjectId, "Site A");
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("DISTRICT_OFFICER", district._id as Types.ObjectId);

    const res = await request(app)
      .post("/api/v1/decisions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "APPROVE",
        justification: "Too short.",
      });

    expect(res.status).toBe(400);
  });

  it("MODIFY requires at least one overriddenFields entry", async () => {
    const district = await seedDistrict("DEC-RT-003");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "DEC-RT-003-H1");
    const site = await seedSite(district._id as Types.ObjectId, "Site A");
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("DISTRICT_OFFICER", district._id as Types.ObjectId);

    const res = await request(app)
      .post("/api/v1/decisions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "MODIFY",
        justification: LONG_JUSTIFICATION,
      });

    expect(res.status).toBe(422);
  });

  it("MODIFY applies a valid selectedSiteId override and records from/to values", async () => {
    const district = await seedDistrict("DEC-RT-004");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "DEC-RT-004-H1");
    const siteA = await seedSite(district._id as Types.ObjectId, "Site A");
    const siteB = await seedSite(district._id as Types.ObjectId, "Site B");
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      siteA._id as Types.ObjectId,
      siteB._id as Types.ObjectId,
    );
    const token = await tokenForRole("DISTRICT_OFFICER", district._id as Types.ObjectId);

    const res = await request(app)
      .post("/api/v1/decisions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "MODIFY",
        justification: LONG_JUSTIFICATION,
        overriddenFields: [
          {
            field: "selectedSiteId",
            fromValue: (siteA._id as Types.ObjectId).toString(),
            toValue: (siteB._id as Types.ObjectId).toString(),
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.recommendation.status).toBe("MODIFIED");
    expect(res.body.recommendation.selectedSiteId).toBe((siteB._id as Types.ObjectId).toString());
    expect(res.body.decision.overriddenFields).toHaveLength(1);
    expect(res.body.decision.overriddenFields[0].toValue).toBe((siteB._id as Types.ObjectId).toString());
  });

  it("rejects a MODIFY whose fromValue is stale (does not match current state)", async () => {
    const district = await seedDistrict("DEC-RT-005");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "DEC-RT-005-H1");
    const siteA = await seedSite(district._id as Types.ObjectId, "Site A");
    const siteB = await seedSite(district._id as Types.ObjectId, "Site B");
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      siteA._id as Types.ObjectId,
      siteB._id as Types.ObjectId,
    );
    const token = await tokenForRole("DISTRICT_OFFICER", district._id as Types.ObjectId);

    const res = await request(app)
      .post("/api/v1/decisions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "MODIFY",
        justification: LONG_JUSTIFICATION,
        overriddenFields: [
          { field: "selectedSiteId", fromValue: "000000000000000000000000", toValue: (siteB._id as Types.ObjectId).toString() },
        ],
      });

    expect(res.status).toBe(409);
  });

  it("rejects deciding an already-decided recommendation", async () => {
    const district = await seedDistrict("DEC-RT-006");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "DEC-RT-006-H1");
    const site = await seedSite(district._id as Types.ObjectId, "Site A");
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("DISTRICT_OFFICER", district._id as Types.ObjectId);
    const body = {
      recommendationId: (recommendation._id as Types.ObjectId).toString(),
      action: "APPROVE",
      justification: LONG_JUSTIFICATION,
    };

    const first = await request(app).post("/api/v1/decisions").set("Authorization", `Bearer ${token}`).send(body);
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/v1/decisions").set("Authorization", `Bearer ${token}`).send(body);
    expect(second.status).toBe(409);
  });

  it("rejects a role without recommendation:approve", async () => {
    const district = await seedDistrict("DEC-RT-007");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "DEC-RT-007-H1");
    const site = await seedSite(district._id as Types.ObjectId, "Site A");
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("STATE_ADMIN", undefined, "Kerala");

    const res = await request(app)
      .post("/api/v1/decisions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "APPROVE",
        justification: LONG_JUSTIFICATION,
      });

    expect(res.status).toBe(403);
  });

  it("returns 404 for a recommendation out of a DISTRICT_OFFICER's scope", async () => {
    const own = await seedDistrict("DEC-RT-008A");
    const other = await seedDistrict("DEC-RT-008B");
    const habitation = await seedHabitation(other._id as Types.ObjectId, "DEC-RT-008-H1");
    const site = await seedSite(other._id as Types.ObjectId, "Site A");
    const recommendation = await seedRecommendation(
      other._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("DISTRICT_OFFICER", own._id as Types.ObjectId);

    const res = await request(app)
      .post("/api/v1/decisions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "APPROVE",
        justification: LONG_JUSTIFICATION,
      });

    expect(res.status).toBe(404);
  });

  it("GET /recommendations/:id/audit-trail returns the decision, its audit entries, and chain verification", async () => {
    const district = await seedDistrict("DEC-RT-009");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "DEC-RT-009-H1");
    const site = await seedSite(district._id as Types.ObjectId, "Site A");
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("DISTRICT_OFFICER", district._id as Types.ObjectId);

    await request(app)
      .post("/api/v1/decisions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "APPROVE",
        justification: LONG_JUSTIFICATION,
      });

    const res = await request(app)
      .get(`/api/v1/recommendations/${(recommendation._id as Types.ObjectId).toString()}/audit-trail`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.auditEntries.length).toBeGreaterThan(0);
    expect(res.body.chainVerification.valid).toBe(true);
  });

  it("GET /decisions filters by recommendationId and is scoped", async () => {
    const district = await seedDistrict("DEC-RT-010");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "DEC-RT-010-H1");
    const site = await seedSite(district._id as Types.ObjectId, "Site A");
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("DISTRICT_OFFICER", district._id as Types.ObjectId);

    await request(app)
      .post("/api/v1/decisions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "REJECT",
        justification: LONG_JUSTIFICATION,
      });

    const res = await request(app)
      .get("/api/v1/decisions")
      .query({ recommendationId: (recommendation._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].action).toBe("REJECT");

    const updated = await Recommendation.findById(recommendation._id as Types.ObjectId);
    expect(updated!.status).toBe("REJECTED");
  });

  it("SECURITY: GET /decisions?districtId= for another district is rejected (404), not silently substituted for the caller's own scope", async () => {
    // Same class of bug as recommendation.routes.ts/scenario.routes.ts's
    // identical fixes, caught before this new districtId query param
    // (added for Step 9 Part 2's district situation report) ever shipped
    // unchecked.
    const own = await seedDistrict("DEC-RT-011A");
    const other = await seedDistrict("DEC-RT-011B");
    const habitation = await seedHabitation(other._id as Types.ObjectId, "DEC-RT-011-H1");
    const site = await seedSite(other._id as Types.ObjectId, "Site B");
    const recommendation = await seedRecommendation(
      other._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const otherToken = await tokenForRole("DISTRICT_OFFICER", other._id as Types.ObjectId);
    await request(app)
      .post("/api/v1/decisions")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "REJECT",
        justification: LONG_JUSTIFICATION,
      });

    const ownToken = await tokenForRole("DISTRICT_OFFICER", own._id as Types.ObjectId);
    const res = await request(app)
      .get(`/api/v1/decisions?districtId=${(other._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${ownToken}`);

    expect(res.status).toBe(404);
  });
});
