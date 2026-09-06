/**
 * Loads data/processed/<district>-factors.json (written by
 * services/ml/scripts/derive_factors.py) back into GridCell.factors.
 * Idempotent — upserts by h3Index, so re-running after regenerating
 * factors is safe.
 *
 * Usage (from apps/api): npm run ingest-factors
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnyBulkWriteOperation } from "mongoose";
import { connectDb, disconnectDb } from "../lib/db";
import { env } from "../lib/env";
import { GridCell, type GridCellDoc } from "../models";

const PROCESSED_DIR = join(__dirname, "..", "..", "..", "..", "data", "processed");
const DISTRICT_SLUGS = ["wayanad", "ganjam", "chamoli"];

type FactorsFile = Record<string, Record<string, Record<string, number>>>;

async function ingestForDistrict(slug: string): Promise<{ matched: number; modified: number }> {
  const path = join(PROCESSED_DIR, `${slug}-factors.json`);
  const raw = readFileSync(path, "utf-8");
  const factorsByCell = JSON.parse(raw) as FactorsFile;

  const ops: AnyBulkWriteOperation<GridCellDoc>[] = Object.entries(factorsByCell).map(
    ([h3Index, factors]) => ({
      updateOne: {
        filter: { h3Index },
        update: { $set: { factors } },
      },
    }),
  );

  if (ops.length === 0) {
    return { matched: 0, modified: 0 };
  }
  const result = await GridCell.bulkWrite(ops);
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

async function main(): Promise<void> {
  await connectDb(env.MONGODB_URI);
  console.log(`[ingestFactors] Connected to ${env.MONGODB_URI}`);

  const summary: Array<{ district: string; matched: number; modified: number }> = [];
  for (const slug of DISTRICT_SLUGS) {
    const { matched, modified } = await ingestForDistrict(slug);
    summary.push({ district: slug, matched, modified });
  }

  console.log("\n[ingestFactors] Summary:");
  console.table(summary);

  await disconnectDb();
}

main().catch((error: unknown) => {
  console.error("[ingestFactors] Failed:", error);
  process.exitCode = 1;
});
