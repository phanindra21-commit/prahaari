import { describe, it, expect } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { Habitation } from "../models/Habitation";
import { FieldReport } from "../models/FieldReport";
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

async function makeUser(role: "FIELD_VOLUNTEER" | "ANALYST" | "SUPER_ADMIN", districtId?: Types.ObjectId) {
  return User.create({
    name: `Test ${role}`,
    email: `${role.toLowerCase()}-${new Types.ObjectId().toString()}@prahari.gov.in`,
    passwordHash: await hashPassword("SomePassw0rd!23"),
    role,
    scope: districtId ? { districtId } : {},
    isActive: true,
  });
}

async function seedFieldReport(habitationId: Types.ObjectId, submittedBy: Types.ObjectId) {
  return FieldReport.create({
    habitationId,
    observationType: "GROUND_CRACK",
    photos: [],
    notes: "Test observation",
    location: { type: "Point", coordinates: [76.05, 11.65] },
    submittedBy,
    verificationStatus: "PENDING",
  });
}

describe("field report routes integration (Step 10 Part 4B)", () => {
  it("a FIELD_VOLUNTEER sees only their OWN submitted reports, never another volunteer's", async () => {
    const district = await seedDistrict("FR-RT-001");
    const districtId = district._id as Types.ObjectId;
    const habitation = await seedHabitation(districtId, "FR-RT-001-A", "Test Habitation");
    const habitationId = habitation._id as Types.ObjectId;

    const volunteerA = await makeUser("FIELD_VOLUNTEER", districtId);
    const volunteerB = await makeUser("FIELD_VOLUNTEER", districtId);
    await seedFieldReport(habitationId, volunteerA._id as Types.ObjectId);
    await seedFieldReport(habitationId, volunteerB._id as Types.ObjectId);

    const tokenA = signAccessToken(volunteerA).token;
    const res = await request(app)
      .get("/api/v1/field-reports")
      .query({ districtId: districtId.toString() })
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].submittedBy._id).toBe((volunteerA._id as Types.ObjectId).toString());
  });

  it("an ANALYST sees every report in their district, not just their own", async () => {
    const district = await seedDistrict("FR-RT-002");
    const districtId = district._id as Types.ObjectId;
    const habitation = await seedHabitation(districtId, "FR-RT-002-A", "Test Habitation");
    const habitationId = habitation._id as Types.ObjectId;

    const volunteer = await makeUser("FIELD_VOLUNTEER", districtId);
    const analyst = await makeUser("ANALYST", districtId);
    await seedFieldReport(habitationId, volunteer._id as Types.ObjectId);

    const token = signAccessToken(analyst).token;
    const res = await request(app)
      .get("/api/v1/field-reports")
      .query({ districtId: districtId.toString() })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it("scopes a FIELD_VOLUNTEER out of another district's reports entirely", async () => {
    const own = await seedDistrict("FR-RT-003-A");
    const other = await seedDistrict("FR-RT-003-B");
    const otherHabitation = await seedHabitation(other._id as Types.ObjectId, "FR-RT-003-B-1", "Other Habitation");

    const volunteer = await makeUser("FIELD_VOLUNTEER", own._id as Types.ObjectId);
    await seedFieldReport(otherHabitation._id as Types.ObjectId, volunteer._id as Types.ObjectId);

    const token = signAccessToken(volunteer).token;
    const res = await request(app)
      .get("/api/v1/field-reports")
      .query({ districtId: (other._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);

    // requireDistrictInScope rejects a district outside the caller's scope
    // before the FieldReport query ever runs.
    expect(res.status).toBe(404);
  });
});
