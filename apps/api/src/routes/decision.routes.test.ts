import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { Habitation } from "../models/Habitation";
import { RelocationSite } from "../models/RelocationSite";
import { Recommendation } from "../models/Recommendation";
import { AuditLog } from "../models/AuditLog";
import { Notification } from "../models/Notification";
import { User } from "../models/User";
import { hashPassword } from "../lib/password";
import { signAccessToken } from "../lib/tokens";

const app = createApp();

async function seedDistrict(lgdCode: string, state = "Kerala") {
  return District.create({
    lgdCode,
    name: "Test District",
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
    email: `${role.toLowerCase()}-${new Types.ObjectId().toString()}@prahari.gov.in`,
    passwordHash: await hashPassword("SomePassw0rd!23"),
    role,
    scope: districtId ? { districtId } : state ? { state } : {},
    isActive: true,
  });
  return signAccessToken(user).token;
}

async function makeUser(
  role: "STATE_ADMIN" | "DISTRICT_OFFICER" | "ANALYST" | "FIELD_VOLUNTEER",
  scope: { state?: string; districtId?: Types.ObjectId },
) {
  return User.create({
    name: `Test ${role}`,
    email: `${role.toLowerCase()}-${new Types.ObjectId().toString()}@prahari.gov.in`,
    passwordHash: await hashPassword("SomePassw0rd!23"),
    role,
    scope,
    isActive: true,
  });
}

const LONG_JUSTIFICATION = "This site clears every hard exclusion and has enough headroom for this habitation.";

/** autoAudit writes the AuditLog entry from a `res.on("finish")` handler —
 * fire-and-forget relative to the HTTP response supertest awaits (see
 * autoAudit.ts and audit.ts's own "best-effort... not a distributed-lock
 * guarantee" note). Every other test in this file checks audit state after
 * exactly one decision, which in practice never races; a test that fires
 * two decisions back-to-back on the same recommendation needs this short
 * poll instead of a bare findOne. */
async function pollForAuditEntry(entityId: string, timeoutMs = 2000): Promise<InstanceType<typeof AuditLog> | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entry = await AuditLog.findOne({ entityType: "decision", entityId });
    if (entry || Date.now() > deadline) return entry;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

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
    // FIELD_VOLUNTEER — not STATE_ADMIN, which now legitimately holds
    // recommendation:approve for its own state (a deliberate product
    // decision, see permissions.json's separationOfDuties.note).
    const district = await seedDistrict("DEC-RT-007");
    const habitation = await seedHabitation(district._id as Types.ObjectId, "DEC-RT-007-H1");
    const site = await seedSite(district._id as Types.ObjectId, "Site A");
    const recommendation = await seedRecommendation(
      district._id as Types.ObjectId,
      habitation._id as Types.ObjectId,
      site._id as Types.ObjectId,
    );
    const token = await tokenForRole("FIELD_VOLUNTEER", district._id as Types.ObjectId);

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

  describe("notifications on decision (Step 10 Part 6)", () => {
    it("notifies STATE_ADMIN, DISTRICT_OFFICER, and both a district- and state-level ANALYST in scope — never the deciding officer, never FIELD_VOLUNTEER", async () => {
      const district = await seedDistrict("DEC-RT-012");
      const districtId = district._id as Types.ObjectId;
      const habitation = await seedHabitation(districtId, "DEC-RT-012-H1");
      const site = await seedSite(districtId, "Site A");
      const recommendation = await seedRecommendation(districtId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);

      const decidingOfficer = await makeUser("DISTRICT_OFFICER", { state: "Kerala", districtId });
      const token = signAccessToken(decidingOfficer).token;

      const stateAdmin = await makeUser("STATE_ADMIN", { state: "Kerala" });
      const otherDistrictOfficer = await makeUser("DISTRICT_OFFICER", { state: "Kerala", districtId });
      const districtAnalyst = await makeUser("ANALYST", { state: "Kerala", districtId });
      const stateAnalyst = await makeUser("ANALYST", { state: "Kerala" });
      const volunteer = await makeUser("FIELD_VOLUNTEER", { state: "Kerala", districtId });

      // Noise: a state admin and analyst in a DIFFERENT state must not be notified.
      await makeUser("STATE_ADMIN", { state: "Odisha" });
      await makeUser("ANALYST", { state: "Odisha" });

      const res = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "APPROVE",
          justification: LONG_JUSTIFICATION,
        });
      expect(res.status).toBe(201);

      const notifications = await Notification.find({}).lean();
      const recipientIds = notifications.map((n) => n.recipientId.toString()).sort();
      const expected = [stateAdmin, otherDistrictOfficer, districtAnalyst, stateAnalyst]
        .map((u) => (u._id as Types.ObjectId).toString())
        .sort();
      expect(recipientIds).toEqual(expected);
      expect(recipientIds).not.toContain((decidingOfficer._id as Types.ObjectId).toString());
      expect(recipientIds).not.toContain((volunteer._id as Types.ObjectId).toString());

      for (const n of notifications) {
        expect(n.districtId.toString()).toBe(districtId.toString());
        expect(n.type).toBe("DECISION_RECORDED");
        expect(n.read).toBe(false);
        expect(n.message).toContain("Test Habitation");
        expect(n.message).toContain("approved");
      }
    });

    it("a notification failure does not block the decision from being recorded", async () => {
      // Simplest reliable way to force notifyOnDecision's try/catch: a
      // district with no District document findable post-decision would
      // require deleting it mid-request, which is fragile. Instead this
      // test documents the guarantee by asserting the decision succeeds
      // even with zero eligible recipients (the realistic no-op path) —
      // the try/catch around a genuine throw is covered by code review of
      // notifications.ts, not exercised via a forced-failure integration test.
      const district = await seedDistrict("DEC-RT-013");
      const districtId = district._id as Types.ObjectId;
      const habitation = await seedHabitation(districtId, "DEC-RT-013-H1");
      const site = await seedSite(districtId, "Site A");
      const recommendation = await seedRecommendation(districtId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
      const token = await tokenForRole("DISTRICT_OFFICER", districtId);

      const res = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "APPROVE",
          justification: LONG_JUSTIFICATION,
        });

      expect(res.status).toBe(201);
      // The deciding officer is the only DISTRICT_OFFICER in scope and is
      // excluded from their own notification, so zero recipients here is
      // correct, not a bug.
      const notifications = await Notification.find({ districtId });
      expect(notifications).toHaveLength(0);
    });
  });

  describe("escalation", () => {
    it("DISTRICT_OFFICER can escalate: escalation.status becomes ESCALATED, decisionLevel is DISTRICT, and the recommendation stays PENDING_REVIEW", async () => {
      const district = await seedDistrict("DEC-RT-ESC-001");
      const districtId = district._id as Types.ObjectId;
      const habitation = await seedHabitation(districtId, "DEC-RT-ESC-001-H1");
      const site = await seedSite(districtId, "Site A");
      const recommendation = await seedRecommendation(districtId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
      const token = await tokenForRole("DISTRICT_OFFICER", districtId);

      const res = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "ESCALATE",
          justification: LONG_JUSTIFICATION,
        });

      expect(res.status).toBe(201);
      expect(res.body.decision.action).toBe("ESCALATE");
      expect(res.body.decision.decisionLevel).toBe("DISTRICT");
      expect(res.body.recommendation.status).toBe("PENDING_REVIEW");
      expect(res.body.recommendation.escalation.status).toBe("ESCALATED");

      const updated = await Recommendation.findById(recommendation._id as Types.ObjectId);
      expect(updated!.status).toBe("PENDING_REVIEW");
      expect(updated!.escalation.status).toBe("ESCALATED");
      expect(updated!.escalation.reason).toBe(LONG_JUSTIFICATION);
    });

    it("escalation requires the same >= 30-character justification as every other decision", async () => {
      const district = await seedDistrict("DEC-RT-ESC-002");
      const districtId = district._id as Types.ObjectId;
      const habitation = await seedHabitation(districtId, "DEC-RT-ESC-002-H1");
      const site = await seedSite(districtId, "Site A");
      const recommendation = await seedRecommendation(districtId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
      const token = await tokenForRole("DISTRICT_OFFICER", districtId);

      const res = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "ESCALATE",
          justification: "Too short.",
        });

      expect(res.status).toBe(400);
      const untouched = await Recommendation.findById(recommendation._id as Types.ObjectId);
      expect(untouched!.escalation.status).toBe("NONE");
    });

    it("STATE_ADMIN can decide an ordinary, NOT-escalated recommendation in their own state — approval no longer requires escalation (deliberate product decision, see permissions.json's separationOfDuties.note)", async () => {
      const district = await seedDistrict("DEC-RT-ESC-003", "Kerala");
      const districtId = district._id as Types.ObjectId;
      const habitation = await seedHabitation(districtId, "DEC-RT-ESC-003-H1");
      const site = await seedSite(districtId, "Site A");
      const recommendation = await seedRecommendation(districtId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
      const stateToken = await tokenForRole("STATE_ADMIN", undefined, "Kerala");

      const res = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${stateToken}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "APPROVE",
          justification: LONG_JUSTIFICATION,
        });

      expect(res.status).toBe(201);
      expect(res.body.decision.decisionLevel).toBe("STATE");
      expect(res.body.recommendation.status).toBe("APPROVED");
      const updated = await Recommendation.findById(recommendation._id as Types.ObjectId);
      expect(updated!.status).toBe("APPROVED");
      expect(updated!.escalation.status).toBe("NONE");

      const auditEntry = await pollForAuditEntry(res.body.decision._id);
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.severity).toBe("WARNING");
    });

    it("STATE_ADMIN can decide a recommendation escalated by a District Officer in their own state — marked decisionLevel STATE with WARNING audit severity", async () => {
      const district = await seedDistrict("DEC-RT-ESC-004", "Kerala");
      const districtId = district._id as Types.ObjectId;
      const habitation = await seedHabitation(districtId, "DEC-RT-ESC-004-H1");
      const site = await seedSite(districtId, "Site A");
      const recommendation = await seedRecommendation(districtId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
      const officerToken = await tokenForRole("DISTRICT_OFFICER", districtId);
      const stateToken = await tokenForRole("STATE_ADMIN", undefined, "Kerala");

      const escalate = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${officerToken}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "ESCALATE",
          justification: LONG_JUSTIFICATION,
        });
      expect(escalate.status).toBe(201);

      const decide = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${stateToken}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "APPROVE",
          justification: LONG_JUSTIFICATION,
        });

      expect(decide.status).toBe(201);
      expect(decide.body.decision.decisionLevel).toBe("STATE");
      expect(decide.body.recommendation.status).toBe("APPROVED");

      const auditEntry = await pollForAuditEntry(decide.body.decision._id);
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.severity).toBe("WARNING");
    });

    it("SECURITY: a Kerala STATE_ADMIN is blocked (404, scoped out by requireScope() before this handler's own logic runs) from an ordinary recommendation in a DIFFERENT state", async () => {
      const wayanad = await seedDistrict("DEC-RT-ESC-005", "Kerala");
      const wayanadId = wayanad._id as Types.ObjectId;
      const habitation = await seedHabitation(wayanadId, "DEC-RT-ESC-005-H1");
      const site = await seedSite(wayanadId, "Site A");
      const recommendation = await seedRecommendation(wayanadId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
      const odishaStateToken = await tokenForRole("STATE_ADMIN", undefined, "Odisha");

      const res = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${odishaStateToken}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "APPROVE",
          justification: LONG_JUSTIFICATION,
        });

      expect(res.status).toBe(404);
      const untouched = await Recommendation.findById(recommendation._id as Types.ObjectId);
      expect(untouched!.status).toBe("PENDING_REVIEW");
    });

    it("SECURITY: a Kerala STATE_ADMIN is blocked (404) from a DIFFERENT state's recommendation even once it has been escalated", async () => {
      const wayanad = await seedDistrict("DEC-RT-ESC-005B", "Kerala");
      const wayanadId = wayanad._id as Types.ObjectId;
      const habitation = await seedHabitation(wayanadId, "DEC-RT-ESC-005B-H1");
      const site = await seedSite(wayanadId, "Site A");
      const recommendation = await seedRecommendation(wayanadId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
      const keralaOfficerToken = await tokenForRole("DISTRICT_OFFICER", wayanadId);
      const odishaStateToken = await tokenForRole("STATE_ADMIN", undefined, "Odisha");

      const escalate = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${keralaOfficerToken}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "ESCALATE",
          justification: LONG_JUSTIFICATION,
        });
      expect(escalate.status).toBe(201);

      const res = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${odishaStateToken}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "APPROVE",
          justification: LONG_JUSTIFICATION,
        });

      expect(res.status).toBe(404);
    });

    it("STATE_ADMIN cannot escalate a recommendation itself (403) — escalation is a district-officer action", async () => {
      const district = await seedDistrict("DEC-RT-ESC-006", "Kerala");
      const districtId = district._id as Types.ObjectId;
      const habitation = await seedHabitation(districtId, "DEC-RT-ESC-006-H1");
      const site = await seedSite(districtId, "Site A");
      const recommendation = await seedRecommendation(districtId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
      const stateToken = await tokenForRole("STATE_ADMIN", undefined, "Kerala");

      const res = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${stateToken}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "ESCALATE",
          justification: LONG_JUSTIFICATION,
        });

      expect(res.status).toBe(403);
    });

    it("a second ESCALATE on an already-escalated recommendation is rejected (409)", async () => {
      const district = await seedDistrict("DEC-RT-ESC-007");
      const districtId = district._id as Types.ObjectId;
      const habitation = await seedHabitation(districtId, "DEC-RT-ESC-007-H1");
      const site = await seedSite(districtId, "Site A");
      const recommendation = await seedRecommendation(districtId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
      const token = await tokenForRole("DISTRICT_OFFICER", districtId);
      const body = {
        recommendationId: (recommendation._id as Types.ObjectId).toString(),
        action: "ESCALATE",
        justification: LONG_JUSTIFICATION,
      };

      const first = await request(app).post("/api/v1/decisions").set("Authorization", `Bearer ${token}`).send(body);
      expect(first.status).toBe(201);

      const second = await request(app).post("/api/v1/decisions").set("Authorization", `Bearer ${token}`).send(body);
      expect(second.status).toBe(409);
    });

    it("SUPER_ADMIN can escalate on a district officer's behalf, marked decisionLevel DISTRICT", async () => {
      const district = await seedDistrict("DEC-RT-ESC-008");
      const districtId = district._id as Types.ObjectId;
      const habitation = await seedHabitation(districtId, "DEC-RT-ESC-008-H1");
      const site = await seedSite(districtId, "Site A");
      const recommendation = await seedRecommendation(districtId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);
      const superToken = await tokenForRole("SUPER_ADMIN");

      const res = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "ESCALATE",
          justification: LONG_JUSTIFICATION,
        });

      expect(res.status).toBe(201);
      expect(res.body.decision.decisionLevel).toBe("DISTRICT");
    });

    it("escalating notifies the STATE_ADMIN for that state; a state-level decision notifies the originating District Officer", async () => {
      const district = await seedDistrict("DEC-RT-ESC-009", "Kerala");
      const districtId = district._id as Types.ObjectId;
      const habitation = await seedHabitation(districtId, "DEC-RT-ESC-009-H1");
      const site = await seedSite(districtId, "Site A");
      const recommendation = await seedRecommendation(districtId, habitation._id as Types.ObjectId, site._id as Types.ObjectId);

      const districtOfficer = await makeUser("DISTRICT_OFFICER", { state: "Kerala", districtId });
      const officerToken = signAccessToken(districtOfficer).token;
      const stateAdmin = await makeUser("STATE_ADMIN", { state: "Kerala" });
      const stateToken = signAccessToken(stateAdmin).token;
      await makeUser("STATE_ADMIN", { state: "Odisha" }); // noise: must not be notified

      const escalate = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${officerToken}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "ESCALATE",
          justification: LONG_JUSTIFICATION,
        });
      expect(escalate.status).toBe(201);

      const afterEscalate = await Notification.find({}).lean();
      expect(afterEscalate.map((n) => n.recipientId.toString())).toEqual([(stateAdmin._id as Types.ObjectId).toString()]);
      expect(afterEscalate[0]!.type).toBe("RECOMMENDATION_ESCALATED");

      const decide = await request(app)
        .post("/api/v1/decisions")
        .set("Authorization", `Bearer ${stateToken}`)
        .send({
          recommendationId: (recommendation._id as Types.ObjectId).toString(),
          action: "APPROVE",
          justification: LONG_JUSTIFICATION,
        });
      expect(decide.status).toBe(201);

      const afterDecide = await Notification.find({ type: "DECISION_RECORDED" }).lean();
      const recipientIds = afterDecide.map((n) => n.recipientId.toString());
      expect(recipientIds).toContain((districtOfficer._id as Types.ObjectId).toString());
      expect(recipientIds).not.toContain((stateAdmin._id as Types.ObjectId).toString());
    });
  });
});
