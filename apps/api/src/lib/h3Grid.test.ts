import { describe, it, expect } from "vitest";
import * as h3 from "h3-js";
import { cellsForBoundary, cellGeometry, slugify } from "./h3Grid";
import type { GeoPolygonal } from "@prahari/shared";

const SMALL_SQUARE: GeoPolygonal = {
  type: "Polygon",
  coordinates: [[[76.0, 11.6], [76.05, 11.6], [76.05, 11.65], [76.0, 11.65], [76.0, 11.6]]],
};

describe("h3Grid helpers", () => {
  it("fills a polygon with valid resolution-8 H3 cells", () => {
    const cells = cellsForBoundary(SMALL_SQUARE, 8);
    expect(cells.size).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(h3.isValidCell(cell)).toBe(true);
      expect(h3.getResolution(cell)).toBe(8);
    }
  });

  it("computes a closed-ring boundary and a centroid inside it for a cell", () => {
    const cells = cellsForBoundary(SMALL_SQUARE, 8);
    const [firstCell] = Array.from(cells);
    const geometry = cellGeometry(firstCell as string);
    expect(geometry.centroid.type).toBe("Point");
    const ring = geometry.boundary.coordinates[0] as [number, number][];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring.length).toBeGreaterThanOrEqual(6);
  });

  it("handles a MultiPolygon boundary by unioning cells from every polygon", () => {
    const multi: GeoPolygonal = {
      type: "MultiPolygon",
      coordinates: [SMALL_SQUARE.coordinates as never, [[[76.2, 11.6], [76.25, 11.6], [76.25, 11.65], [76.2, 11.65], [76.2, 11.6]]]],
    };
    const singleCells = cellsForBoundary(SMALL_SQUARE, 8);
    const multiCells = cellsForBoundary(multi, 8);
    expect(multiCells.size).toBeGreaterThan(singleCells.size);
  });

  it("slugifies a district name for use as a filename", () => {
    expect(slugify("Wayanad")).toBe("wayanad");
    expect(slugify("St. Thomas Mount")).toBe("st-thomas-mount");
  });
});
