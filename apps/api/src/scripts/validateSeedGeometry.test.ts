import { describe, it, expect } from "vitest";
import type { GeoPolygonal } from "@punarvas/shared";
import {
  findHabitationsOutsideDistrict,
  assertHabitationsWithinDistricts,
  type DistrictCheckInput,
  type HabitationCheckInput,
} from "./validateSeedGeometry";

const SQUARE: GeoPolygonal = {
  type: "Polygon",
  coordinates: [[[76.0, 11.5], [76.2, 11.5], [76.2, 11.7], [76.0, 11.7], [76.0, 11.5]]],
};

const districts: DistrictCheckInput[] = [{ lgdCode: "D1", name: "Test District", boundary: SQUARE }];

describe("validateSeedGeometry", () => {
  it("finds no violations when every habitation is inside its district", () => {
    const habitations: HabitationCheckInput[] = [
      { lgdHabitationCode: "H1", name: "Inside One", districtLgdCode: "D1", coordinates: [76.1, 11.6] },
      { lgdHabitationCode: "H2", name: "Inside Two", districtLgdCode: "D1", coordinates: [76.05, 11.55] },
    ];
    expect(findHabitationsOutsideDistrict(districts, habitations)).toEqual([]);
    expect(() => assertHabitationsWithinDistricts(districts, habitations)).not.toThrow();
  });

  it("flags a habitation south of the boundary — the exact Chooralmala/Mundakkai failure mode", () => {
    const habitations: HabitationCheckInput[] = [
      { lgdHabitationCode: "H1", name: "Chooralmala-like", districtLgdCode: "D1", coordinates: [76.09, 11.40] },
    ];
    const violations = findHabitationsOutsideDistrict(districts, habitations);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.habitation).toBe("Chooralmala-like");
    expect(() => assertHabitationsWithinDistricts(districts, habitations)).toThrow(
      /fall outside their district/,
    );
  });

  it("lists every offending habitation in the thrown error message", () => {
    const habitations: HabitationCheckInput[] = [
      { lgdHabitationCode: "H1", name: "Outside A", districtLgdCode: "D1", coordinates: [76.09, 11.40] },
      { lgdHabitationCode: "H2", name: "Outside B", districtLgdCode: "D1", coordinates: [76.5, 11.6] },
      { lgdHabitationCode: "H3", name: "Inside C", districtLgdCode: "D1", coordinates: [76.1, 11.6] },
    ];
    expect(() => assertHabitationsWithinDistricts(districts, habitations)).toThrow(
      /Outside A[\s\S]*Outside B/,
    );
  });

  it("treats the boundary itself as inclusive-ish (point exactly on an edge is a coordinate rounding concern, not tested here) and correctly excludes a point just past a vertex", () => {
    const habitations: HabitationCheckInput[] = [
      { lgdHabitationCode: "H1", name: "Just North", districtLgdCode: "D1", coordinates: [76.1, 11.71] },
    ];
    const violations = findHabitationsOutsideDistrict(districts, habitations);
    expect(violations).toHaveLength(1);
  });

  it("throws a clear error for a habitation referencing an unknown district", () => {
    const habitations: HabitationCheckInput[] = [
      { lgdHabitationCode: "H1", name: "Orphan", districtLgdCode: "UNKNOWN", coordinates: [76.1, 11.6] },
    ];
    expect(() => findHabitationsOutsideDistrict(districts, habitations)).toThrow(/unknown district/);
  });

  it("supports a MultiPolygon district boundary", () => {
    const multi: DistrictCheckInput[] = [
      {
        lgdCode: "D2",
        name: "Multi District",
        boundary: {
          type: "MultiPolygon",
          coordinates: [
            [[[76.0, 11.5], [76.1, 11.5], [76.1, 11.6], [76.0, 11.6], [76.0, 11.5]]],
            [[[76.3, 11.5], [76.4, 11.5], [76.4, 11.6], [76.3, 11.6], [76.3, 11.5]]],
          ],
        },
      },
    ];
    const habitations: HabitationCheckInput[] = [
      { lgdHabitationCode: "H1", name: "In first part", districtLgdCode: "D2", coordinates: [76.05, 11.55] },
      { lgdHabitationCode: "H2", name: "In second part", districtLgdCode: "D2", coordinates: [76.35, 11.55] },
      { lgdHabitationCode: "H3", name: "In the gap", districtLgdCode: "D2", coordinates: [76.2, 11.55] },
    ];
    const violations = findHabitationsOutsideDistrict(multi, habitations);
    expect(violations.map((v) => v.habitation)).toEqual(["In the gap"]);
  });
});
