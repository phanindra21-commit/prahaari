import * as h3 from "h3-js";
import type { GeoPolygonal, GeoPoint, GeoPolygon } from "@punarvas/shared";

/** Every ring-set of a GeoPolygonal, grouped per polygon (h3.polygonToCells takes one polygon's [outerRing, ...holeRings] at a time). */
function polygonsOf(boundary: GeoPolygonal): number[][][][] {
  return boundary.type === "Polygon" ? [boundary.coordinates] : boundary.coordinates;
}

/** Fills `boundary` with H3 cells at `resolution`. GeoJSON ring coordinates are [lng, lat]; h3.polygonToCells(..., isGeoJson=true) accepts that order directly. */
export function cellsForBoundary(boundary: GeoPolygonal, resolution: number): Set<string> {
  const cells = new Set<string>();
  for (const rings of polygonsOf(boundary)) {
    for (const cell of h3.polygonToCells(rings, resolution, true)) {
      cells.add(cell);
    }
  }
  return cells;
}

/** Centroid + closed-ring boundary geometry for a single H3 cell, regenerated from the index itself (never persisted separately). */
export function cellGeometry(h3Index: string): { centroid: GeoPoint; boundary: GeoPolygon } {
  const [lat, lng] = h3.cellToLatLng(h3Index);
  const ring = h3.cellToBoundary(h3Index, true) as [number, number][];
  return {
    centroid: { type: "Point", coordinates: [lng, lat] },
    boundary: { type: "Polygon", coordinates: [ring] },
  };
}

/** Lowercase, hyphenated, filesystem-safe slug for a district name (e.g. for data/processed/<slug>-factors.json). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}
