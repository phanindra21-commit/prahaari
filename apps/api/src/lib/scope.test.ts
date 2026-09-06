import { describe, it, expect } from "vitest";
import { District } from "../models/District";
import { buildScopeFilter } from "./scope";

const boundary = {
  type: "Polygon" as const,
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ] as [number, number][],
  ],
};

async function makeDistrict(lgdCode: string, state: string) {
  return District.create({
    lgdCode,
    name: lgdCode,
    state,
    boundary,
    population: 1000,
    areaSqKm: 10,
    primaryHazards: ["flood"],
    dmAuthorityContact: { name: "T", designation: "T", phone: "0" },
  });
}

describe("buildScopeFilter (Step 3 Part C2)", () => {
  it("SUPER_ADMIN gets no restriction", async () => {
    const filter = await buildScopeFilter({ role: "SUPER_ADMIN" });
    expect(filter).toEqual({});
  });

  it("STATE_ADMIN gets an $in filter over districts in their state", async () => {
    const kerala1 = await makeDistrict("KL-1", "Kerala");
    const kerala2 = await makeDistrict("KL-2", "Kerala");
    await makeDistrict("OD-1", "Odisha");

    const filter = await buildScopeFilter({ role: "STATE_ADMIN", state: "Kerala" });
    const inClause = (filter.districtId as { $in: unknown[] }).$in.map(String).sort();
    expect(inClause).toEqual([kerala1._id.toString(), kerala2._id.toString()].sort());
  });

  it("STATE_ADMIN with no state configured matches nothing", async () => {
    const filter = await buildScopeFilter({ role: "STATE_ADMIN" });
    expect(filter).toEqual({ _id: { $exists: false } });
  });

  it("DISTRICT_OFFICER is restricted to their single district", async () => {
    const district = await makeDistrict("KL-3", "Kerala");
    const filter = await buildScopeFilter({
      role: "DISTRICT_OFFICER",
      districtId: district._id.toString(),
    });
    expect(filter).toEqual({ districtId: district._id.toString() });
  });

  it("ANALYST and FIELD_VOLUNTEER follow the same single-district rule", async () => {
    const district = await makeDistrict("KL-4", "Kerala");
    const analystFilter = await buildScopeFilter({
      role: "ANALYST",
      districtId: district._id.toString(),
    });
    const volunteerFilter = await buildScopeFilter({
      role: "FIELD_VOLUNTEER",
      districtId: district._id.toString(),
    });
    expect(analystFilter).toEqual({ districtId: district._id.toString() });
    expect(volunteerFilter).toEqual({ districtId: district._id.toString() });
  });

  it("a state-level ANALYST (scope.state set, no districtId — Step 10 Part 5) gets the same state-wide $in filter as STATE_ADMIN", async () => {
    const kerala1 = await makeDistrict("KL-6", "Kerala");
    const kerala2 = await makeDistrict("KL-7", "Kerala");
    await makeDistrict("OD-2", "Odisha");

    const filter = await buildScopeFilter({ role: "ANALYST", state: "Kerala" });
    const inClause = (filter.districtId as { $in: unknown[] }).$in.map(String).sort();
    expect(inClause).toEqual([kerala1._id.toString(), kerala2._id.toString()].sort());
  });

  it("a district-level ANALYST (districtId set) is still restricted to that one district, even if scope.state is also set", async () => {
    const district = await makeDistrict("KL-8", "Kerala");
    const filter = await buildScopeFilter({
      role: "ANALYST",
      state: "Kerala",
      districtId: district._id.toString(),
    });
    expect(filter).toEqual({ districtId: district._id.toString() });
  });

  it("a district-scoped role with no districtId configured matches nothing (never falls open)", async () => {
    const filter = await buildScopeFilter({ role: "DISTRICT_OFFICER" });
    expect(filter).toEqual({ _id: { $exists: false } });
  });

  it("supports a custom districtField for non-standard collections (e.g. User.scope.districtId)", async () => {
    const district = await makeDistrict("KL-5", "Kerala");
    const filter = await buildScopeFilter(
      { role: "DISTRICT_OFFICER", districtId: district._id.toString() },
      { districtField: "scope.districtId" },
    );
    expect(filter).toEqual({ "scope.districtId": district._id.toString() });
  });
});
