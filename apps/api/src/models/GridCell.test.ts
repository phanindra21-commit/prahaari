import { describe, it, expect } from "vitest";
import { GridCell } from "./GridCell";
import { District } from "./District";

async function seedDistrict(): Promise<string> {
  const district = await District.create({
    lgdCode: "GRIDCELL-TEST-001",
    name: "Test District",
    state: "Testland",
    boundary: {
      type: "Polygon",
      coordinates: [[[76.0, 11.6], [76.1, 11.6], [76.1, 11.7], [76.0, 11.7], [76.0, 11.6]]],
    },
    population: 1000,
    areaSqKm: 10,
    primaryHazards: ["landslide"],
    dmAuthorityContact: { name: "Test", designation: "Tester", phone: "0000000000" },
  });
  return district._id.toString();
}

describe("GridCell model", () => {
  it("persists a cell with per-hazard factors and hazardScores", async () => {
    const districtId = await seedDistrict();
    const doc = await GridCell.create({
      h3Index: "88283082a3fffff",
      resolution: 8,
      districtId,
      centroid: { type: "Point", coordinates: [76.05, 11.65] },
      boundary: {
        type: "Polygon",
        coordinates: [[[76.04, 11.64], [76.06, 11.64], [76.06, 11.66], [76.04, 11.66], [76.04, 11.64]]],
      },
      factors: { landslide: { slope: 22.5, lithology: 0.4 } },
      hazardScores: new Map([
        ["landslide", { overlayScore: 0.6, mlScore: 0.55, blendedScore: 0.58, zoneClass: "Orange" }],
      ]),
      modelVersion: "test-v1",
      computedAt: new Date(),
      dataProvenance: "SYNTHETIC_DEMO",
    });

    // .lean() bypasses document hydration, so a Map-typed field comes back
    // as a plain object rather than a Map instance — index it directly.
    const found = await GridCell.findOne({ h3Index: "88283082a3fffff" }).lean<{
      factors: Record<string, Record<string, number>>;
      hazardScores: Record<string, { zoneClass: string }>;
    }>();
    expect(found?.factors.landslide?.slope).toBe(22.5);
    expect(found?.hazardScores.landslide?.zoneClass).toBe("Orange");
    expect(doc.dataProvenance).toBe("SYNTHETIC_DEMO");
  });

  it("rejects a duplicate h3Index", async () => {
    const districtId = await seedDistrict();
    const base = {
      resolution: 8,
      districtId,
      centroid: { type: "Point" as const, coordinates: [76.05, 11.65] as [number, number] },
      boundary: {
        type: "Polygon" as const,
        coordinates: [[[76.04, 11.64], [76.06, 11.64], [76.06, 11.66], [76.04, 11.66], [76.04, 11.64]]],
      },
      factors: {},
      hazardScores: new Map(),
      modelVersion: "test-v1",
      computedAt: new Date(),
      dataProvenance: "SYNTHETIC_DEMO" as const,
    };
    await GridCell.create({ ...base, h3Index: "88283082a5fffff" });
    await expect(GridCell.create({ ...base, h3Index: "88283082a5fffff" })).rejects.toThrow();
  });
});
