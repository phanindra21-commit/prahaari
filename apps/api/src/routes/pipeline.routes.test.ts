import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { GridCell } from "../models/GridCell";
import { Habitation } from "../models/Habitation";
import { Assessment } from "../models/Assessment";
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

function startMockMlServer(): void {
  mlServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }

    if (req.url === "/zoning/run") {
      void readJsonBody<{
        hazardType: string;
        cells: Array<{ h3Index: string; district: string; factors: Record<string, number> }>;
      }>(req).then((body) => {
        const cellScores = body.cells.map((cell) => {
          const slope = cell.factors.slope ?? 0;
          const blended = Math.min(1, slope / 45);
          const zoneClass =
            blended >= 0.7 ? "Red" : blended >= 0.5 ? "Orange" : blended >= 0.25 ? "Yellow" : "Green";
          return {
            h3Index: cell.h3Index,
            district: cell.district,
            overlayScore: blended,
            mlScore: blended,
            blendedScore: blended,
            zoneClass,
            topFactors: [{ factor: "slope", contribution: 0.3, direction: "INCREASES_RISK" }],
          };
        });
        const classes = [...new Set(cellScores.map((c) => c.zoneClass))];
        const zones = classes.map((zoneClass) => ({
          district: body.cells[0]?.district ?? "wayanad",
          zoneClass,
          cellCount: cellScores.filter((c) => c.zoneClass === zoneClass).length,
          geometry: DUMMY_GEOMETRY,
          simplifiedGeometry: DUMMY_GEOMETRY,
        }));
        const responseBody = {
          hazardType: body.hazardType,
          cellScores,
          zones,
          metrics: { aucRoc: 0.6, precision: 0.5, recall: 0.5, f1: 0.5, calibrationError: 0.1 },
          featureList: Object.keys(body.cells[0]?.factors ?? {}),
          trainingSampleCount: body.cells.length,
          labelSource: "SYNTHETIC_DEMO",
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseBody));
      });
      return;
    }

    if (req.url === "/assessment/run") {
      void readJsonBody<{
        hazardZones: Record<string, Array<{ zoneClass: string; hazardScore: number }>>;
        habitations: Array<{ habitationId: string }>;
      }>(req).then((body) => {
        const hazardTypes = Object.keys(body.hazardZones);
        const assessments = body.habitations.map((h, i) => {
          // First habitation in the batch: Red + high VI-ish inputs -> Immediate.
          // Rest: Green, unbucketed.
          const isFirst = i === 0;
          const zoneClass = isFirst ? "Red" : "Green";
          return {
            habitationId: h.habitationId,
            hazardExposure: hazardTypes.map((hazardType) => ({
              hazardType,
              hazardScore: isFirst ? 0.8 : 0.1,
              exposure: isFirst ? 1.0 : 0.0,
              zoneClass,
            })),
            vulnerabilityIndex: 0.5,
            vulnerabilityDimensions: { demographic: 0.5, socioeconomic: 0.5, structural: 0.5, accessibility: 0.5 },
            copingCapacity: 0.3,
            compositeRiskScore: isFirst ? 0.6 : 0.02,
            governingHazard: hazardTypes[0],
            overallZoneClass: zoneClass,
            relocationPriorityIndex: isFirst ? 0.78 : null,
            priorityBucket: isFirst ? "Immediate" : null,
            explanation: isFirst
              ? [{ factor: "risk", contribution: 0.4, direction: "INCREASES_RISK", label: "Overall risk" }]
              : [],
          };
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ assessments }));
      });
      return;
    }

    res.writeHead(404).end();
  });
  mlServer.listen(58231, "127.0.0.1");
}

beforeAll(() => {
  startMockMlServer();
});

afterAll(async () => {
  await new Promise<void>((resolve) => mlServer.close(() => resolve()));
});

async function seedDistrict(lgdCode: string, primaryHazards: string[] = ["landslide"]) {
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

async function seedHabitations(districtId: Types.ObjectId, count = 2) {
  const demographics = {
    shareUnder5: 0.1, shareOver60: 0.1, womenHeadedHouseholdShare: 0.1,
    disabledPersonsShare: 0.05, bplShare: 0.3, scStShare: 0.2, literacyRate: 0.7,
  };
  const structures = { kutchaHousingShare: 0.2, avgBuildingAgeYears: 20, predominantFoundationType: "STONE_MASONRY" };
  const access = { distanceToAllWeatherRoadKm: 2, distanceToPhcKm: 5, mobileNetworkCoverage: 0.6, evacuationRouteCount: 1 };
  const livelihood = { primaryOccupation: "AGRICULTURE", distanceToLivelihoodAssetKm: 1, primaryLivelihoodDependenceShare: 0.5 };
  const copingCapacity = { sdrfResponseTimeMinutes: 60, shelterWithin2km: true, communityTaskForcePresent: false, earlyWarningCoverage: 0.5 };

  for (let i = 0; i < count; i += 1) {
    await Habitation.create({
      lgdHabitationCode: `PIPE-TEST-H${i}`,
      name: `Test Habitation ${i}`,
      block: "Test Block",
      panchayat: "Test Panchayat",
      districtId,
      centroid: { type: "Point", coordinates: [76.05 + i * 0.001, 11.65] },
      population: 500,
      households: 100,
      demographics,
      structures,
      access,
      livelihood,
      copingCapacity,
      consentStatus: "NOT_ENGAGED",
      dataProvenance: "SYNTHETIC_DEMO",
    });
  }
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

async function waitForJobCompletion(jobId: string, token: string): Promise<{ status: string; result?: unknown }> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const res = await request(app).get(`/api/v1/zoning/runs/${jobId}`).set("Authorization", `Bearer ${token}`);
    if (res.body.status === "SUCCEEDED" || res.body.status === "FAILED") {
      return res.body as { status: string; result?: unknown };
    }
    if (Date.now() > deadline) {
      throw new Error(`Job ${jobId} did not finish within the test deadline (last status: ${res.body.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("pipeline route integration", () => {
  it("runs the full pipeline (zones -> assessments) and persists versioned Assessment docs", async () => {
    const district = await seedDistrict("PIPELINE-RT-001");
    await seedGridCells(district._id as Types.ObjectId, 3);
    await seedHabitations(district._id as Types.ObjectId, 2);
    const token = await tokenForRole("SUPER_ADMIN");

    const runRes = await request(app)
      .post("/api/v1/pipeline/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ districtId: (district._id as Types.ObjectId).toString(), hazardTypes: ["landslide"] });

    expect(runRes.status).toBe(202);
    const finished = await waitForJobCompletion(runRes.body.jobId as string, token);
    expect(finished.status).toBe("SUCCEEDED");

    const assessments = await Assessment.find({}).populate("habitationId");
    expect(assessments).toHaveLength(2);

    const bucketed = assessments.filter((a) => a.priorityBucket !== null);
    const unbucketed = assessments.filter((a) => a.priorityBucket === null);
    expect(bucketed).toHaveLength(1);
    expect(unbucketed).toHaveLength(1);
    expect(bucketed[0]!.priorityBucket).toBe("Immediate");
    expect(bucketed[0]!.explanation.length).toBeGreaterThan(0);
    expect(bucketed[0]!.validTo).toBeNull();
  });

  it("rejects POST /pipeline/run for a role without pipeline:run", async () => {
    const district = await seedDistrict("PIPELINE-RT-002");
    const token = await tokenForRole("FIELD_VOLUNTEER");

    const res = await request(app)
      .post("/api/v1/pipeline/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ districtId: (district._id as Types.ObjectId).toString() });

    expect(res.status).toBe(403);
  });
});
