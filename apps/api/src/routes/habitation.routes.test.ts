import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { Habitation } from "../models/Habitation";
import { User } from "../models/User";
import { hashPassword } from "../lib/password";
import { signAccessToken } from "../lib/tokens";
import { writeAssessmentVersions, type AssessmentVersionInput } from "../lib/assessmentVersioning";

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

async function seedHabitation(districtId: Types.ObjectId, code: string, name: string) {
  return Habitation.create({
    lgdHabitationCode: code,
    name,
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

function assessmentInput(
  habitationId: Types.ObjectId,
  districtId: Types.ObjectId,
  overrides: Partial<AssessmentVersionInput> = {},
): AssessmentVersionInput {
  return {
    habitationId,
    districtId,
    hazardExposure: [{ hazardType: "landslide", hazardScore: 0.8, exposure: 0.9, zoneClass: "Red", disasterHistoryBoost: 0 }],
    vulnerabilityIndex: 0.4,
    vulnerabilityDimensions: { demographic: 0.4, socioeconomic: 0.4, structural: 0.4, accessibility: 0.4 },
    copingCapacity: 0.3,
    compositeRiskScore: 0.6,
    governingHazard: "landslide",
    overallZoneClass: "Red",
    relocationPriorityIndex: 0.75,
    priorityBucket: "Immediate",
    modelVersion: "test-v1",
    explanation: [
      { factor: "risk", contribution: 0.4, direction: "INCREASES_RISK", label: "Overall hazard risk" },
      { factor: "vi", contribution: 0.2, direction: "INCREASES_RISK", label: "Vulnerability index" },
    ],
    compoundHazard: null,
    ...overrides,
  };
}

async function tokenForRole(
  role: "SUPER_ADMIN" | "DISTRICT_OFFICER" | "FIELD_VOLUNTEER" | "ANALYST",
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

describe("habitation routes integration", () => {
  it("GET /habitations lists habitations with an attached assessment summary, filterable by bucket", async () => {
    const district = await seedDistrict("HAB-RT-001");
    const districtId = district._id as Types.ObjectId;
    const assessed = await seedHabitation(districtId, "HAB-RT-001-A", "Assessed Habitation");
    await seedHabitation(districtId, "HAB-RT-001-B", "Unassessed Habitation");
    await writeAssessmentVersions([assessmentInput(assessed._id as Types.ObjectId, districtId)]);

    const token = await tokenForRole("SUPER_ADMIN");

    const all = await request(app)
      .get("/api/v1/habitations")
      .query({ districtId: districtId.toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items).toHaveLength(2);
    const assessedItem = all.body.items.find((i: { name: string }) => i.name === "Assessed Habitation");
    expect(assessedItem.assessment.priorityBucket).toBe("Immediate");
    const unassessedItem = all.body.items.find((i: { name: string }) => i.name === "Unassessed Habitation");
    expect(unassessedItem.assessment).toBeNull();

    const filtered = await request(app)
      .get("/api/v1/habitations")
      .query({ districtId: districtId.toString(), bucket: "Immediate" })
      .set("Authorization", `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0].name).toBe("Assessed Habitation");
  });

  it("GET /habitations?format=geojson returns a FeatureCollection of Point features", async () => {
    const district = await seedDistrict("HAB-RT-002");
    const districtId = district._id as Types.ObjectId;
    await seedHabitation(districtId, "HAB-RT-002-A", "Geo Habitation");
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .get("/api/v1/habitations")
      .query({ districtId: districtId.toString(), format: "geojson" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].type).toBe("Feature");
    expect(res.body.features[0].geometry.type).toBe("Point");
    expect(res.body.features[0].properties.name).toBe("Geo Habitation");
  });

  it("GET /habitations/:id returns full detail with the latest assessment", async () => {
    const district = await seedDistrict("HAB-RT-003");
    const districtId = district._id as Types.ObjectId;
    const habitation = await seedHabitation(districtId, "HAB-RT-003-A", "Detail Habitation");
    await writeAssessmentVersions([assessmentInput(habitation._id as Types.ObjectId, districtId)]);
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .get(`/api/v1/habitations/${(habitation._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Detail Habitation");
    expect(res.body.latestAssessment.priorityBucket).toBe("Immediate");
    expect(res.body.latestAssessment.hazardExposure[0].zoneClass).toBe("Red");
  });

  it("GET /habitations/:id/assessment supports ?at= for a superseded historical version", async () => {
    const district = await seedDistrict("HAB-RT-004");
    const districtId = district._id as Types.ObjectId;
    const habitation = await seedHabitation(districtId, "HAB-RT-004-A", "History Habitation");
    const habitationId = habitation._id as Types.ObjectId;
    const t1 = new Date(Date.now() - 60_000);
    const t2 = new Date();

    await writeAssessmentVersions(
      [assessmentInput(habitationId, districtId, { modelVersion: "v1", priorityBucket: "ShortTerm", relocationPriorityIndex: 0.5 })],
      t1,
    );
    await writeAssessmentVersions(
      [assessmentInput(habitationId, districtId, { modelVersion: "v2", priorityBucket: "Immediate", relocationPriorityIndex: 0.8 })],
      t2,
    );

    const token = await tokenForRole("SUPER_ADMIN");

    const current = await request(app)
      .get(`/api/v1/habitations/${habitationId.toString()}/assessment`)
      .set("Authorization", `Bearer ${token}`);
    expect(current.status).toBe(200);
    expect(current.body.modelVersion).toBe("v2");

    const historical = await request(app)
      .get(`/api/v1/habitations/${habitationId.toString()}/assessment`)
      .query({ at: t1.toISOString() })
      .set("Authorization", `Bearer ${token}`);
    expect(historical.status).toBe(200);
    expect(historical.body.modelVersion).toBe("v1");
  });

  it("GET /habitations/:id/explain returns a plain-language summary and the sorted factor breakdown", async () => {
    const district = await seedDistrict("HAB-RT-005");
    const districtId = district._id as Types.ObjectId;
    const habitation = await seedHabitation(districtId, "HAB-RT-005-A", "Explain Habitation");
    await writeAssessmentVersions([assessmentInput(habitation._id as Types.ObjectId, districtId)]);
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .get(`/api/v1/habitations/${(habitation._id as Types.ObjectId).toString()}/explain`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toContain("Explain Habitation");
    expect(res.body.summary).toContain("Immediate");
    expect(res.body.explanation).toHaveLength(2);
  });

  it("GET /priorities ranks Red/Orange assessments by RPI and excludes unbucketed ones", async () => {
    const district = await seedDistrict("HAB-RT-006");
    const districtId = district._id as Types.ObjectId;
    const high = await seedHabitation(districtId, "HAB-RT-006-A", "High Priority");
    const low = await seedHabitation(districtId, "HAB-RT-006-B", "Low Priority");
    const green = await seedHabitation(districtId, "HAB-RT-006-C", "Green Habitation");

    await writeAssessmentVersions([
      assessmentInput(high._id as Types.ObjectId, districtId, { relocationPriorityIndex: 0.9, priorityBucket: "Immediate" }),
      assessmentInput(low._id as Types.ObjectId, districtId, { relocationPriorityIndex: 0.5, priorityBucket: "ShortTerm" }),
      assessmentInput(green._id as Types.ObjectId, districtId, {
        overallZoneClass: "Green",
        relocationPriorityIndex: null,
        priorityBucket: null,
        hazardExposure: [{ hazardType: "landslide", hazardScore: 0.1, exposure: 0.0, zoneClass: "Green", disasterHistoryBoost: 0 }],
      }),
    ]);

    const token = await tokenForRole("SUPER_ADMIN");
    const res = await request(app)
      .get("/api/v1/priorities")
      .query({ districtId: districtId.toString() })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((i: { habitationName: string }) => i.habitationName)).toEqual([
      "High Priority",
      "Low Priority",
    ]);
    expect(res.body.items[0].topFactor.factor).toBe("risk");
  });

  it("scopes a DISTRICT_OFFICER to their own district on every new route", async () => {
    const districtA = await seedDistrict("HAB-RT-007-A");
    const districtB = await seedDistrict("HAB-RT-007-B");
    const habitationB = await seedHabitation(districtB._id as Types.ObjectId, "HAB-RT-007-B-1", "Other District Habitation");
    await writeAssessmentVersions([
      assessmentInput(habitationB._id as Types.ObjectId, districtB._id as Types.ObjectId),
    ]);

    const habitationA = await seedHabitation(districtA._id as Types.ObjectId, "HAB-RT-007-A-1", "Own District Habitation");
    const token = await tokenForRole("DISTRICT_OFFICER", districtA._id as Types.ObjectId);

    // Positive case first: the officer CAN see their own district's data.
    // (Regression coverage for a bug where the scope filter's
    // req.auth.scope.districtId/state were read off the wrong object shape
    // and silently matched nothing for every non-SUPER_ADMIN role — every
    // prior test here only asserted the negative case below, which
    // "passed" even when scoping matched nothing for both districts.)
    const ownList = await request(app)
      .get("/api/v1/habitations")
      .query({ districtId: (districtA._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(ownList.status).toBe(200);
    expect(ownList.body.items.map((i: { id: string }) => i.id)).toContain(
      (habitationA._id as Types.ObjectId).toString(),
    );

    const list = await request(app)
      .get("/api/v1/habitations")
      .query({ districtId: (districtB._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(404);

    const detail = await request(app)
      .get(`/api/v1/habitations/${(habitationB._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(404);

    const priorities = await request(app)
      .get("/api/v1/priorities")
      .query({ districtId: (districtB._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(priorities.status).toBe(404);
  });

  it("GET /habitations/:id omits latestAssessment for a role without assessment:read, includes it for one with it (Step 10 Part 4B)", async () => {
    const district = await seedDistrict("HAB-RT-010");
    const districtId = district._id as Types.ObjectId;
    const habitation = await seedHabitation(districtId, "HAB-RT-010-A", "Leak Check Habitation");
    await writeAssessmentVersions([assessmentInput(habitation._id as Types.ObjectId, districtId)]);
    const habitationId = (habitation._id as Types.ObjectId).toString();

    const volunteerToken = await tokenForRole("FIELD_VOLUNTEER", districtId);
    const volunteerRes = await request(app)
      .get(`/api/v1/habitations/${habitationId}`)
      .set("Authorization", `Bearer ${volunteerToken}`);
    expect(volunteerRes.status).toBe(200);
    expect(volunteerRes.body.latestAssessment).toBeNull();

    const analystToken = await tokenForRole("ANALYST", districtId);
    const analystRes = await request(app)
      .get(`/api/v1/habitations/${habitationId}`)
      .set("Authorization", `Bearer ${analystToken}`);
    expect(analystRes.status).toBe(200);
    expect(analystRes.body.latestAssessment.priorityBucket).toBe("Immediate");
  });

  it("rejects a FIELD_VOLUNTEER from /priorities (no assessment:read) but allows /habitations (habitation:read)", async () => {
    const district = await seedDistrict("HAB-RT-008");
    const token = await tokenForRole("FIELD_VOLUNTEER", district._id as Types.ObjectId);

    const priorities = await request(app).get("/api/v1/priorities").set("Authorization", `Bearer ${token}`);
    expect(priorities.status).toBe(403);

    const list = await request(app).get("/api/v1/habitations").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
  });

  it("surfaces a compound hazard on /explain and /priorities when persisted on the Assessment", async () => {
    const district = await seedDistrict("HAB-RT-009");
    const districtId = district._id as Types.ObjectId;
    const habitation = await seedHabitation(districtId, "HAB-RT-009-A", "Compound Habitation");
    await writeAssessmentVersions([
      assessmentInput(habitation._id as Types.ObjectId, districtId, {
        governingHazard: "landslide",
        compoundHazard: {
          trigger: "cloudburst",
          mechanism: "landslide",
          triggerRisk: 0.28,
          mechanismRisk: 0.27,
          compoundRisk: 0.4744,
        },
      }),
    ]);
    const token = await tokenForRole("SUPER_ADMIN");
    const habitationId = (habitation._id as Types.ObjectId).toString();

    const explain = await request(app)
      .get(`/api/v1/habitations/${habitationId}/explain`)
      .set("Authorization", `Bearer ${token}`);
    expect(explain.status).toBe(200);
    expect(explain.body.compoundHazard).toEqual({
      trigger: "cloudburst",
      mechanism: "landslide",
      triggerRisk: 0.28,
      mechanismRisk: 0.27,
      compoundRisk: 0.4744,
    });
    expect(explain.body.summary).toContain("cloudburst");
    expect(explain.body.summary).toContain("landslide");
    expect(explain.body.summary).toContain("compound hazard");

    const priorities = await request(app)
      .get("/api/v1/priorities")
      .query({ districtId: districtId.toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(priorities.body.items[0].compoundHazard.trigger).toBe("cloudburst");
    expect(priorities.body.items[0].compoundHazard.mechanism).toBe("landslide");
  });
});
