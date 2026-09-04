import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { Types } from "mongoose";
import { createApp } from "../app";
import { District } from "../models/District";
import { GridCell } from "../models/GridCell";
import { ModelRun } from "../models/ModelRun";
import { User } from "../models/User";
import { hashPassword } from "../lib/password";
import { signAccessToken } from "../lib/tokens";

const app = createApp();

const DUMMY_GEOMETRY = {
  type: "Polygon",
  coordinates: [[[76.0, 11.6], [76.1, 11.6], [76.1, 11.7], [76.0, 11.7], [76.0, 11.6]]],
};

let mlServer: Server;
let lastZoningRequestBody: {
  hazardType: string;
  cells: Array<{ h3Index: string; district: string; factors: Record<string, number> }>;
} | null = null;

function startMockMlServer(): void {
  mlServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || req.url !== "/zoning/run") {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      const body = JSON.parse(raw) as {
        hazardType: string;
        cells: Array<{ h3Index: string; district: string; factors: Record<string, number> }>;
      };
      lastZoningRequestBody = body;
      const cellScores = body.cells.map((cell) => {
        const slope = cell.factors.slope ?? 0;
        const blended = Math.min(1, slope / 45);
        const zoneClass = blended >= 0.7 ? "Red" : blended >= 0.5 ? "Orange" : blended >= 0.25 ? "Yellow" : "Green";
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
  });
  mlServer.listen(58231, "127.0.0.1");
}

beforeAll(() => {
  startMockMlServer();
});

afterAll(async () => {
  await new Promise<void>((resolve) => mlServer.close(() => resolve()));
});

async function seedDistrict(lgdCode: string, primaryHazards: string[] = ["landslide"], name = "Test District") {
  return District.create({
    lgdCode,
    name,
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

async function seedGridCells(
  districtId: Types.ObjectId,
  count = 3,
  hazardType = "landslide",
  h3Prefix = "88283082a",
) {
  const cells = [];
  for (let i = 0; i < count; i += 1) {
    cells.push(
      await GridCell.create({
        h3Index: `${h3Prefix}${i}fffff`,
        resolution: 8,
        districtId,
        centroid: { type: "Point", coordinates: [76.05 + i * 0.001, 11.65] },
        boundary: {
          type: "Polygon",
          coordinates: [[[76.04, 11.64], [76.06, 11.64], [76.06, 11.66], [76.04, 11.66], [76.04, 11.64]]],
        },
        factors: { [hazardType]: { slope: 10 + i * 15, lithology: 0.4 } },
        modelVersion: "PENDING_SCORE",
        computedAt: new Date(),
        dataProvenance: "SYNTHETIC_DEMO",
      }),
    );
  }
  return cells;
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

async function waitForJobCompletion(jobId: string, token: string): Promise<{ status: string }> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const res = await request(app).get(`/api/v1/zoning/runs/${jobId}`).set("Authorization", `Bearer ${token}`);
    if (res.body.status === "SUCCEEDED" || res.body.status === "FAILED") {
      return res.body as { status: string };
    }
    if (Date.now() > deadline) {
      throw new Error(`Job ${jobId} did not finish within the test deadline (last status: ${res.body.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("zoning routes integration", () => {
  it("runs a zoning job end to end: scores cells, persists zones, and serves them back", async () => {
    const district = await seedDistrict("ZONING-RT-001");
    await seedGridCells(district._id as Types.ObjectId, 3);
    const token = await tokenForRole("SUPER_ADMIN");

    const runRes = await request(app)
      .post("/api/v1/zoning/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ districtId: (district._id as Types.ObjectId).toString(), hazardTypes: ["landslide"] });

    expect(runRes.status).toBe(202);
    expect(runRes.body.jobId).toBeTypeOf("string");

    const finished = await waitForJobCompletion(runRes.body.jobId as string, token);
    expect(finished.status).toBe("SUCCEEDED");

    const updatedCells = await GridCell.find({ districtId: district._id }).lean();
    for (const cell of updatedCells) {
      expect(cell.hazardScores).toBeDefined();
    }

    const modelRuns = await ModelRun.find({ hazardType: "landslide" });
    expect(modelRuns.length).toBeGreaterThan(0);
    expect(modelRuns[0]?.labelSource).toBe("SYNTHETIC_DEMO");

    const zonesRes = await request(app)
      .get("/api/v1/zones")
      .query({ districtId: (district._id as Types.ObjectId).toString(), hazardType: "landslide" })
      .set("Authorization", `Bearer ${token}`);
    expect(zonesRes.status).toBe(200);
    expect(zonesRes.body.items.length).toBeGreaterThan(0);

    const historyRes = await request(app)
      .get("/api/v1/zones/history")
      .query({ districtId: (district._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.items.length).toBe(zonesRes.body.items.length);

    const gridRes = await request(app)
      .get("/api/v1/grid")
      .query({
        districtId: (district._id as Types.ObjectId).toString(),
        minLon: 76.0,
        minLat: 11.6,
        maxLon: 76.2,
        maxLat: 11.7,
      })
      .set("Authorization", `Bearer ${token}`);
    expect(gridRes.status).toBe(200);
    expect(gridRes.body.returned).toBe(3);
    expect(gridRes.body.capped).toBe(false);

    const explainRes = await request(app)
      .get(`/api/v1/grid/88283082a0fffff/explain`)
      .query({ hazardType: "landslide" })
      .set("Authorization", `Bearer ${token}`);
    expect(explainRes.status).toBe(200);
    expect(explainRes.body.topFactors.length).toBeGreaterThan(0);
  });

  it("rejects POST /zoning/run for a role without pipeline:run", async () => {
    const district = await seedDistrict("ZONING-RT-002");
    const token = await tokenForRole("FIELD_VOLUNTEER");

    const res = await request(app)
      .post("/api/v1/zoning/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ districtId: (district._id as Types.ObjectId).toString() });

    expect(res.status).toBe(403);
  });

  it("scopes a DISTRICT_OFFICER to their own district: another district's zones are invisible", async () => {
    const ownDistrict = await seedDistrict("ZONING-RT-003A");
    const otherDistrict = await seedDistrict("ZONING-RT-003B");
    const token = await tokenForRole("DISTRICT_OFFICER", ownDistrict._id as Types.ObjectId);

    const res = await request(app)
      .get("/api/v1/zones")
      .query({ districtId: (otherDistrict._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("a DISTRICT_OFFICER CAN see their own district's zones (positive-case regression: scoping must not match nothing for every role)", async () => {
    const district = await seedDistrict("ZONING-RT-003C");
    await seedGridCells(district._id as Types.ObjectId, 3);
    const superAdminToken = await tokenForRole("SUPER_ADMIN");

    const runRes = await request(app)
      .post("/api/v1/zoning/run")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ districtId: (district._id as Types.ObjectId).toString(), hazardTypes: ["landslide"] });
    await waitForJobCompletion(runRes.body.jobId as string, superAdminToken);

    const officerToken = await tokenForRole("DISTRICT_OFFICER", district._id as Types.ObjectId);
    const res = await request(app)
      .get("/api/v1/zones")
      .query({ districtId: (district._id as Types.ObjectId).toString() })
      .set("Authorization", `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("pools cells across every district sharing a hazard for training, but only writes the requested district's GridCells", async () => {
    const districtA = await seedDistrict("ZONING-RT-005A", ["flood"], "Pool District A");
    const districtB = await seedDistrict("ZONING-RT-005B", ["flood"], "Pool District B");
    await seedGridCells(districtA._id as Types.ObjectId, 3, "flood", "88283090a");
    await seedGridCells(districtB._id as Types.ObjectId, 4, "flood", "88283091a");
    const token = await tokenForRole("SUPER_ADMIN");

    const runRes = await request(app)
      .post("/api/v1/zoning/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ districtId: (districtA._id as Types.ObjectId).toString(), hazardTypes: ["flood"] });
    expect(runRes.status).toBe(202);

    const finished = await waitForJobCompletion(runRes.body.jobId as string, token);
    expect(finished.status).toBe("SUCCEEDED");

    // The ML service saw cells from BOTH districts in one pooled training call.
    expect(lastZoningRequestBody?.cells.length).toBe(7);
    const districtsInRequest = new Set(lastZoningRequestBody?.cells.map((c) => c.district));
    expect(districtsInRequest.size).toBe(2);

    // But only district A's GridCells were actually written.
    const updatedA = await GridCell.find({ districtId: districtA._id }).lean();
    const updatedB = await GridCell.find({ districtId: districtB._id }).lean();
    expect(updatedA.every((c) => c.hazardScores?.flood)).toBe(true);
    expect(updatedB.every((c) => !c.hazardScores?.flood)).toBe(true);
  });

  it("rejects a hazardType the district does not list as a primary hazard", async () => {
    const district = await seedDistrict("ZONING-RT-004", ["coastalErosion"]);
    const token = await tokenForRole("SUPER_ADMIN");

    const res = await request(app)
      .post("/api/v1/zoning/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ districtId: (district._id as Types.ObjectId).toString(), hazardTypes: ["landslide"] });

    expect(res.status).toBe(422);
  });
});
