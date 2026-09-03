import { describe, it, expect } from "vitest";
import type { GeoPolygon } from "@punarvas/shared";
import { District } from "../models/District";
import { HazardZone } from "../models/HazardZone";
import { writeZoneVersion, getActiveZones, type ZoneVersionInput } from "./zoneVersioning";

async function seedDistrict(lgdCode: string): Promise<import("mongoose").Types.ObjectId> {
  const district = await District.create({
    lgdCode,
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
  return district._id;
}

const SQUARE: GeoPolygon = {
  type: "Polygon",
  coordinates: [[[76.0, 11.6], [76.02, 11.6], [76.02, 11.62], [76.0, 11.62], [76.0, 11.6]]],
};

function zone(zoneClass: ZoneVersionInput["zoneClass"], modelVersion: string): ZoneVersionInput {
  return {
    zoneClass,
    geometry: SQUARE,
    hazardScore: 0.5,
    factorContributions: { slope: 0.3 },
    modelVersion,
    generatedBy: "MODEL",
    dataProvenance: "SYNTHETIC_DEMO",
  };
}

describe("zoneVersioning", () => {
  it("first run: creates every zone with no supersession", async () => {
    const districtId = await seedDistrict("ZV-TEST-001");
    const result = await writeZoneVersion(districtId, "landslide", [
      zone("Red", "v1"),
      zone("Orange", "v1"),
    ]);

    expect(result.created).toHaveLength(2);
    expect(result.supersededCount).toBe(0);
    for (const doc of result.created) {
      expect(doc.validTo).toBeNull();
      expect(doc.supersedes).toBeNull();
    }
  });

  it("second run: closes every previously-active doc, supersedes same-class docs, leaves a dropped class closed with no successor", async () => {
    const districtId = await seedDistrict("ZV-TEST-002");
    const t1 = new Date(Date.now());
    const t2 = new Date(Date.now() + 60_000);

    const run1 = await writeZoneVersion(
      districtId,
      "landslide",
      [zone("Red", "v1"), zone("Orange", "v1")],
      t1,
    );
    const run1Red = run1.created.find((d) => d.zoneClass === "Red")!;
    const run1Orange = run1.created.find((d) => d.zoneClass === "Orange")!;

    // Run 2: Red drops out (no cell reached Red this time), Orange continues, Yellow is new.
    const run2 = await writeZoneVersion(
      districtId,
      "landslide",
      [zone("Orange", "v2"), zone("Yellow", "v2")],
      t2,
    );

    expect(run2.created).toHaveLength(2);
    expect(run2.supersededCount).toBe(2);

    const run2Orange = run2.created.find((d) => d.zoneClass === "Orange")!;
    const run2Yellow = run2.created.find((d) => d.zoneClass === "Yellow")!;
    expect(run2Orange.supersedes?.toString()).toBe(run1Orange._id.toString());
    expect(run2Yellow.supersedes).toBeNull(); // no prior Yellow to supersede

    const closedRed = await HazardZone.findById(run1Red._id);
    const closedOrange = await HazardZone.findById(run1Orange._id);
    expect(closedRed?.validTo?.getTime()).toBe(t2.getTime());
    expect(closedOrange?.validTo?.getTime()).toBe(t2.getTime());

    const active = await getActiveZones({ districtId, hazardType: "landslide", at: t2 });
    expect(active.map((d) => d._id.toString()).sort()).toEqual(
      [run2Orange._id.toString(), run2Yellow._id.toString()].sort(),
    );
  });

  it("third run yields a clean supersession chain with no orphans and no overlapping validity windows", async () => {
    const districtId = await seedDistrict("ZV-TEST-003");
    const t1 = new Date(Date.now());
    const t2 = new Date(Date.now() + 60_000);
    const t3 = new Date(Date.now() + 120_000);

    const run1 = await writeZoneVersion(districtId, "landslide", [zone("Orange", "v1")], t1);
    const run2 = await writeZoneVersion(districtId, "landslide", [zone("Orange", "v2")], t2);
    const run3 = await writeZoneVersion(districtId, "landslide", [zone("Orange", "v3")], t3);

    const run1Doc = run1.created[0]!;
    const run2Doc = run2.created[0]!;
    const run3Doc = run3.created[0]!;

    // Chain integrity: walk supersedes backwards from the newest doc.
    expect(run3Doc.supersedes?.toString()).toBe(run2Doc._id.toString());
    expect(run2Doc.supersedes?.toString()).toBe(run1Doc._id.toString());
    expect(run1Doc.supersedes).toBeNull();

    const all = await HazardZone.find({ districtId, hazardType: "landslide" }).sort({ validFrom: 1 });
    expect(all).toHaveLength(3);

    // No orphans: exactly one doc (the latest) is active; every other doc is closed.
    const activeDocs = all.filter((d) => d.validTo === null);
    expect(activeDocs).toHaveLength(1);
    expect(activeDocs[0]!._id.toString()).toBe(run3Doc._id.toString());

    // No overlapping validity windows: each closed doc's validTo exactly
    // equals the validFrom of the run that superseded it (no gap, no overlap).
    expect(all[0]!.validTo?.getTime()).toBe(all[1]!.validFrom.getTime());
    expect(all[1]!.validTo?.getTime()).toBe(all[2]!.validFrom.getTime());
    expect(all[2]!.validTo).toBeNull();

    // getActiveZones at an earlier instant returns the doc that was active then.
    const activeAtT1 = await getActiveZones({
      districtId,
      hazardType: "landslide",
      at: new Date(t1.getTime() + 30_000),
    });
    expect(activeAtT1).toHaveLength(1);
    expect(activeAtT1[0]!._id.toString()).toBe(run1Doc._id.toString());
  });
});
