import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { GridCell } from "../models/GridCell";
import { Habitation } from "../models/Habitation";
import { ScenarioRun } from "../models/ScenarioRun";
import { User } from "../models/User";
import { hashPassword } from "../lib/password";
import { signAccessToken } from "../lib/tokens";

const app = createApp();

const DUMMY_GEOMETRY = {
  type: "Polygon",
  coordinates: [[[76.0, 11.6], [76.1, 11.6], [76.1, 11.7], [76.0, 11.7], [76.0, 11.6]]],
};

let mlServer: Server;

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on("end", () => resolve(JSON.parse(raw) as T));
  });
}

interface MockScenarioRequestBody {
  hazardCells: Record<string, Array<{ h3Index: string; district: string; factors: Record<string, number> }>>;
  habitations: Array<{ habitationId: string }>;
}

function startMockMlServer(): void {
  mlServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || req.url !== "/scenarios/run") {
      res.writeHead(404).end();
      return;
    }
    void readJsonBody<MockScenarioRequestBody>(req).then((body) => {
      const hazardSummaries = Object.entries(body.hazardCells).map(([hazard, cells]) => ({
        hazard,
        affected: true,
        baselineZoneCounts: { Red: 1, Orange: 1, Yellow: cells.length - 2, Green: 0 },
        scenarioZoneCounts: { Red: 2, Orange: 1, Yellow: cells.length - 3, Green: 0 },
        cellsChanged: 1,
        newlyRedCells: 1,
      }));
      const firstHabitationId = body.habitations[0]?.habitationId ?? "unknown";
      const responseBody = {
        hazardSummaries,
        cellTransitions: hazardSummaries.map((s) => ({
          hazard: s.hazard,
          fromClass: "Orange",
          toClass: "Red",
          cellCount: 1,
        })),
        habitationDeltas: [
          {
            habitationId: firstHabitationId,
            baselineOverallZoneClass: "Orange",
            scenarioOverallZoneClass: "Red",
            baselinePriorityBucket: "ShortTerm",
            scenarioPriorityBucket: "Immediate",
            enteredImmediate: true,
            zoneClassWorsened: true,
          },
        ],
        habitationsEnteringImmediate: [firstHabitationId],
        zoneGeometries: hazardSummaries.map((s) => ({
          hazard: s.hazard,
          baseline: { Orange: DUMMY_GEOMETRY },
          scenario: { Red: DUMMY_GEOMETRY },
          changed: DUMMY_GEOMETRY,
        })),
        runtimeSeconds: 3.42,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(responseBody));
    });
  });
  mlServer.listen(58231, "127.0.0.1");
}

beforeAll(() => {
  startMockMlServer();
});

afterAll(async () => {
  await new Promise<void>((resolve) => mlServer.close(() => resolve()));
});

async function seedDistrict(lgdCode: string, primaryHazards: string[] = ["landslide"], state = "Testland") {
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
    primaryHazards,
    dmAuthorityContact: { name: "Test", designation: "Tester", phone: "0000000000" },
  });
}

async function seedGridCells(districtId: Types.ObjectId, count = 3) {
  for (let i = 0; i < count; i += 1) {
    await GridCell.create({
      h3Index: `88283082a${i}fffff`,
      resolution: 8,
      districtId,
      centroid: { type: "Point", coordinates: [76.05 + i * 0.001, 11.65] },
      boundary: {
        type: "Polygon",
        coordinates: [[[76.04, 11.64], [76.06, 11.64], [76.06, 11.66], [76.04, 11.66], [76.04, 11.64]]],
      },
      factors: { landslide: { slope: 10 + i * 15, lithology: 0.4 } },
      modelVersion: "PENDING_SCORE",
      computedAt: new Date(),
      dataProvenance: "SYNTHETIC_DEMO",
    });
  }
}

async function seedHabitation(districtId: Types.ObjectId, code: string) {
  return Habitation.create({
    lgdHabitationCode: code,
    name: `Test Habitation ${code}`,
    block: "Test Block",
    panchayat: "Test Panchayat",
    districtId,
    centroid: { type: "Point", coordinates: [76.05, 11.65] },
    population: 500,
    households: 100,
    demographics: {
      shareUnder5: 0.1, shareOver60: 0.1, womenHeadedHouseholdShare: 0.1,
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

describe("scenario routes integration", () => {
  it("POST /scenarios/run persists a ScenarioRun with hazard summaries and habitation deltas", async () => {
    const district = await seedDistrict("SCN-RT-001", ["landslide"], "Kerala");
    await seedGridCells(district._id as Types.ObjectId, 4);
    await seedHabitation(district._id as Types.ObjectId, "SCN-H1");
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .post("/api/v1/scenarios/run")
      .set("Authorization", `Bearer ${token}`)
      .send({
        districtId: (district._id as Types.ObjectId).toString(),
        name: "2024 Wayanad event: 372 mm/24h",
        parameters: { rainfallMmPer24h: 372 },
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("2024 Wayanad event: 372 mm/24h");
    expect(res.body.hazardSummaries).toHaveLength(1);
    expect(res.body.habitationDeltas).toHaveLength(1);
    expect(res.body.habitationDeltas[0].enteredImmediate).toBe(true);
    expect(res.body.habitationsEnteringImmediate).toEqual([`Test Habitation SCN-H1`]);
    expect(res.body.runtimeSeconds).toBeCloseTo(3.42);

    const persisted = await ScenarioRun.find({ districtId: district._id });
    expect(persisted).toHaveLength(1);
  });

  it("rejects a request with no scenario parameters set", async () => {
    const district = await seedDistrict("SCN-RT-002", ["landslide"], "Kerala");
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .post("/api/v1/scenarios/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ districtId: (district._id as Types.ObjectId).toString(), name: "Empty", parameters: {} });

    expect(res.status).toBe(400);
  });

  it("returns 422 when the district has no GridCell factors for its primary hazard", async () => {
    const district = await seedDistrict("SCN-RT-003", ["landslide"], "Kerala");
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .post("/api/v1/scenarios/run")
      .set("Authorization", `Bearer ${token}`)
      .send({
        districtId: (district._id as Types.ObjectId).toString(),
        name: "No grid data",
        parameters: { rainfallMmPer24h: 200 },
      });

    expect(res.status).toBe(422);
  });

  it("scopes a DISTRICT_OFFICER out of another district's scenario run", async () => {
    const own = await seedDistrict("SCN-RT-004A", ["landslide"], "Kerala");
    const other = await seedDistrict("SCN-RT-004B", ["landslide"], "Kerala");
    await seedGridCells(other._id as Types.ObjectId, 4);
    await seedHabitation(other._id as Types.ObjectId, "SCN-H2");
    const token = await tokenForRole("DISTRICT_OFFICER", own._id as Types.ObjectId);

    const res = await request(app)
      .post("/api/v1/scenarios/run")
      .set("Authorization", `Bearer ${token}`)
      .send({
        districtId: (other._id as Types.ObjectId).toString(),
        name: "Cross-district attempt",
        parameters: { rainfallMmPer24h: 300 },
      });

    expect(res.status).toBe(404);
  });

  it("SECURITY: GET /scenarios?districtId= for another district is rejected (404), not silently substituted for the caller's own scope", async () => {
    // Regression test: same class of bug as recommendation.routes.ts's
    // identical fix — the list filter used to overwrite the
    // scope-derived districtId with whatever the query string said,
    // unchecked.
    const own = await seedDistrict("SCN-RT-006A", ["landslide"], "Kerala");
    const other = await seedDistrict("SCN-RT-006B", ["landslide"], "Kerala");
    await ScenarioRun.create({
      name: "Other district's run",
      districtId: other._id,
      hazardTypes: ["landslide"],
      parameters: { rainfallMmPer24h: 300 },
      hazardSummaries: [],
      cellTransitions: [],
      habitationDeltas: [],
      habitationsEnteringImmediate: [],
      zoneGeometries: [],
      runtimeSeconds: 1,
      modelVersion: "test-v1",
      createdBy: new Types.ObjectId(),
    });
    const token = await tokenForRole("DISTRICT_OFFICER", own._id as Types.ObjectId);

    const res = await request(app)
      .get(`/api/v1/scenarios?districtId=${(other._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("GET /scenarios lists saved runs for the district, and GET /scenarios/:id returns one", async () => {
    const district = await seedDistrict("SCN-RT-005", ["landslide"], "Kerala");
    await seedGridCells(district._id as Types.ObjectId, 4);
    await seedHabitation(district._id as Types.ObjectId, "SCN-H3");
    const token = await tokenForRole("SUPER_ADMIN");

    await request(app)
      .post("/api/v1/scenarios/run")
      .set("Authorization", `Bearer ${token}`)
      .send({
        districtId: (district._id as Types.ObjectId).toString(),
        name: "Listable run",
        parameters: { rainfallMmPer24h: 250 },
      });

    const listRes = await request(app)
      .get(`/api/v1/scenarios?districtId=${(district._id as Types.ObjectId).toString()}`)
      .set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(1);

    const id = listRes.body.items[0]._id as string;
    const detailRes = await request(app).get(`/api/v1/scenarios/${id}`).set("Authorization", `Bearer ${token}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.name).toBe("Listable run");
  });

  it("DELETE /scenarios/:id removes a saved run", async () => {
    const district = await seedDistrict("SCN-RT-006", ["landslide"], "Kerala");
    await seedGridCells(district._id as Types.ObjectId, 4);
    await seedHabitation(district._id as Types.ObjectId, "SCN-H4");
    const token = await tokenForRole("SUPER_ADMIN");

    const runRes = await request(app)
      .post("/api/v1/scenarios/run")
      .set("Authorization", `Bearer ${token}`)
      .send({
        districtId: (district._id as Types.ObjectId).toString(),
        name: "To be deleted",
        parameters: { rainfallMmPer24h: 250 },
      });
    const id = runRes.body._id as string;

    const deleteRes = await request(app).delete(`/api/v1/scenarios/${id}`).set("Authorization", `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const stillThere = await ScenarioRun.findById(id);
    expect(stillThere).toBeNull();
  });

  it("rejects a role without scenario:run", async () => {
    const district = await seedDistrict("SCN-RT-007", ["landslide"], "Kerala");
    const token = await tokenForRole("FIELD_VOLUNTEER", district._id as Types.ObjectId);

    const res = await request(app)
      .post("/api/v1/scenarios/run")
      .set("Authorization", `Bearer ${token}`)
      .send({
        districtId: (district._id as Types.ObjectId).toString(),
        name: "Not allowed",
        parameters: { rainfallMmPer24h: 250 },
      });

    expect(res.status).toBe(403);
  });
});
