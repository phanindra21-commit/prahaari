/**
 * Fills every pilot district's boundary with H3 resolution-8 cells and
 * persists them as `GridCell` documents (geometry only — no factors or
 * hazard scores yet, see ingestFactors.ts and the zoning job). Also
 * exports a lightweight `{h3Index, lon, lat}` list per district to
 * data/processed/, so services/ml/scripts/derive_factors.py (a Python
 * offline batch script) can compute spatially-coherent synthetic factor
 * values without needing to talk to MongoDB — services/ml stays
 * stateless per docs/ARCHITECTURE.md.
 *
 * Idempotent: cells are upserted by their unique h3Index.
 *
 * Usage (from apps/api): npm run generate-grid
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AnyBulkWriteOperation, Types } from "mongoose";
import type { GeoPolygonal } from "@prahari/shared";
import { connectDb, disconnectDb } from "../lib/db";
import { env } from "../lib/env";
import { District, GridCell, type GridCellDoc } from "../models";
import { cellsForBoundary, cellGeometry, slugify } from "../lib/h3Grid";

const GRID_RESOLUTION = 8;
const PROCESSED_DIR = join(__dirname, "..", "..", "..", "..", "data", "processed");

interface GridCellSeed {
  h3Index: string;
  lon: number;
  lat: number;
}

interface DistrictForGrid {
  _id: Types.ObjectId;
  name: string;
  areaSqKm: number;
  boundary: GeoPolygonal;
}

async function generateForDistrict(district: DistrictForGrid): Promise<number> {
  const cellIndexes = cellsForBoundary(district.boundary, GRID_RESOLUTION);

  const seedRows: GridCellSeed[] = [];
  const ops: AnyBulkWriteOperation<GridCellDoc>[] = [];

  for (const h3Index of cellIndexes) {
    const { centroid, boundary } = cellGeometry(h3Index);
    const [lon, lat] = centroid.coordinates;
    seedRows.push({ h3Index, lon, lat });

    ops.push({
      updateOne: {
        filter: { h3Index },
        update: {
          $set: {
            h3Index,
            resolution: GRID_RESOLUTION,
            districtId: district._id,
            centroid,
            boundary,
          },
          $setOnInsert: {
            factors: {},
            hazardScores: new Map(),
            modelVersion: "PENDING_SCORE",
            computedAt: new Date(),
            dataProvenance: "SYNTHETIC_DEMO",
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length > 0) {
    await GridCell.bulkWrite(ops);
  }

  mkdirSync(PROCESSED_DIR, { recursive: true });
  const outPath = join(PROCESSED_DIR, `${slugify(district.name)}-grid.json`);
  writeFileSync(outPath, JSON.stringify(seedRows, null, 2), "utf-8");
  console.log(`[generateGrid] wrote ${seedRows.length} cell centroids -> ${outPath}`);

  return cellIndexes.size;
}

async function main(): Promise<void> {
  await connectDb(env.MONGODB_URI);
  console.log(`[generateGrid] Connected to ${env.MONGODB_URI}`);

  const districts = await District.find(
    {},
    { name: 1, areaSqKm: 1, boundary: 1 },
  ).lean<DistrictForGrid[]>();
  if (districts.length === 0) {
    throw new Error("[generateGrid] No districts found — run `npm run seed` first.");
  }

  console.log(`[generateGrid] Filling ${districts.length} district boundaries at H3 resolution ${GRID_RESOLUTION}...`);

  const counts: Array<{ district: string; areaSqKm: number; cellCount: number }> = [];
  for (const district of districts) {
    const cellCount = await generateForDistrict(district);
    counts.push({ district: district.name, areaSqKm: district.areaSqKm, cellCount });
  }

  console.log("\n[generateGrid] Cell counts per district:");
  console.table(counts);

  // Sanity check: mean resolution-8 H3 cell area is ~0.737 sq km, so
  // cellCount * 0.737 should land in the same order of magnitude as the
  // filled boundary's area (the seed boundaries are bounding rectangles,
  // not exact district polygons, so this is a coarse check, not an exact
  // match).
  for (const row of counts) {
    const impliedAreaSqKm = row.cellCount * 0.737;
    const ratio = impliedAreaSqKm / row.areaSqKm;
    if (ratio < 0.3 || ratio > 5) {
      console.warn(
        `[generateGrid] WARNING: ${row.district} cell count (${row.cellCount}) implies ~${impliedAreaSqKm.toFixed(0)} sq km, ` +
          `which is off by more than an order of magnitude from the district's recorded area (${row.areaSqKm} sq km, ratio ${ratio.toFixed(2)}). Investigate before proceeding.`,
      );
    }
  }

  await disconnectDb();
}

main().catch((error: unknown) => {
  console.error("[generateGrid] Failed:", error);
  process.exitCode = 1;
});
