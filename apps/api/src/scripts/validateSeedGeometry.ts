/**
 * Permanent guard against a class of bug this repo already shipped once:
 * Wayanad's Step 2 seed boundary polygon was a bounding rectangle that
 * started at 11.55°N, silently excluding the district's own southern tip
 * (Meppadi taluk — Chooralmala and Mundakkai included) from the H3 grid
 * and every downstream hazard/vulnerability score. This module asserts
 * every seeded habitation centroid falls inside its own district's
 * boundary polygon, and fails loudly (not silently) if one doesn't.
 *
 * Pure geometry, no MongoDB — runs against the raw seed files before any
 * database write, so a bad fixture is caught before it's ever persisted.
 */
import type { GeoPolygonal } from "@punarvas/shared";

function pointInRing(point: [number, number], ring: readonly (readonly [number, number])[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const vi = ring[i];
    const vj = ring[j];
    if (!vi || !vj) continue;
    const [xi, yi] = vi;
    const [xj, yj] = vj;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

/** Standard GeoJSON ring-in-polygon rule: inside the outer ring, outside every hole. */
function pointInPolygonal(point: [number, number], geometry: GeoPolygonal): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const rings of polygons) {
    const [outer, ...holes] = rings;
    if (!outer || !pointInRing(point, outer)) {
      continue;
    }
    const inAHole = holes.some((hole) => pointInRing(point, hole));
    if (!inAHole) {
      return true;
    }
  }
  return false;
}

export interface DistrictCheckInput {
  lgdCode: string;
  name: string;
  boundary: GeoPolygonal;
}

export interface HabitationCheckInput {
  lgdHabitationCode: string;
  name: string;
  districtLgdCode: string;
  coordinates: [number, number];
}

export interface SeedGeometryViolation {
  habitation: string;
  lgdHabitationCode: string;
  district: string;
  coordinates: [number, number];
}

export function findHabitationsOutsideDistrict(
  districts: DistrictCheckInput[],
  habitations: HabitationCheckInput[],
): SeedGeometryViolation[] {
  const districtByLgdCode = new Map(districts.map((d) => [d.lgdCode, d]));
  const violations: SeedGeometryViolation[] = [];

  for (const habitation of habitations) {
    const district = districtByLgdCode.get(habitation.districtLgdCode);
    if (!district) {
      throw new Error(
        `[validateSeedGeometry] Habitation "${habitation.name}" references unknown district lgdCode "${habitation.districtLgdCode}"`,
      );
    }
    if (!pointInPolygonal(habitation.coordinates, district.boundary)) {
      violations.push({
        habitation: habitation.name,
        lgdHabitationCode: habitation.lgdHabitationCode,
        district: district.name,
        coordinates: habitation.coordinates,
      });
    }
  }

  return violations;
}

/** Throws with every offending habitation listed if any centroid falls outside its district. */
export function assertHabitationsWithinDistricts(
  districts: DistrictCheckInput[],
  habitations: HabitationCheckInput[],
): void {
  const violations = findHabitationsOutsideDistrict(districts, habitations);
  if (violations.length === 0) {
    return;
  }
  const lines = violations
    .map(
      (v) =>
        `  - ${v.habitation} (${v.lgdHabitationCode}) in ${v.district}: [${v.coordinates[0]}, ${v.coordinates[1]}]`,
    )
    .join("\n");
  throw new Error(
    `[validateSeedGeometry] ${violations.length} habitation(s) fall outside their district's seed ` +
      `boundary polygon:\n${lines}\n` +
      "Fix the district boundary in data/seed/districts.json or the habitation coordinates — " +
      "never seed data that fails this check.",
  );
}
