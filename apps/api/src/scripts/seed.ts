/**
 * Idempotent seed script for the two pilot districts (Wayanad, Ganjam).
 * Reads the static GeoJSON/JSON files in data/seed/ (never hardcodes
 * habitation-level data here) and upserts them into MongoDB by natural
 * key, so re-running `npm run seed` is safe. `npm run seed:reset` clears
 * every seed-managed collection first.
 *
 * Usage (from repo root): npm run seed | npm run seed:reset
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { Types, type AnyBulkWriteOperation } from "mongoose";
import { z } from "zod";
import { connectDb, disconnectDb } from "../lib/db";
import {
  District,
  Habitation,
  HazardZone,
  HazardEvent,
  RelocationSite,
  User,
  type DistrictDoc,
  type DmAuthorityContact,
  type HabitationDoc,
  type HazardZoneDoc,
  type HazardEventDoc,
  type RelocationSiteDoc,
  type UserDoc,
} from "../models";
import {
  seedDistrictSchema,
  seedHabitationCollectionSchema,
  seedHazardZoneCollectionSchema,
  seedHazardEventSchema,
  seedRelocationSiteCollectionSchema,
  seedUserSchema,
  type SeedUser,
} from "./seedSchemas";

const SEED_DIR = join(__dirname, "..", "..", "..", "..", "data", "seed");
const isReset = process.argv.includes("--reset");
const BCRYPT_ROUNDS = 10;

function readSeedFile(fileName: string): unknown {
  const raw = readFileSync(join(SEED_DIR, fileName), "utf-8");
  return JSON.parse(raw) as unknown;
}

interface SummaryRow {
  collection: string;
  inserted: number;
  updated: number;
  total: number;
}

const summary: SummaryRow[] = [];

function recordSummary(collection: string, upsertedCount: number, matchedCount: number): void {
  summary.push({
    collection,
    inserted: upsertedCount,
    updated: matchedCount,
    total: upsertedCount + matchedCount,
  });
}

async function resetCollections(): Promise<void> {
  console.log("[seed] --reset: clearing seed-managed collections...");
  await Promise.all([
    District.deleteMany({}),
    Habitation.deleteMany({}),
    HazardZone.deleteMany({}),
    HazardEvent.deleteMany({}),
    RelocationSite.deleteMany({}),
    User.deleteMany({}),
  ]);
}

async function seedDistricts(): Promise<Map<string, Types.ObjectId>> {
  const districts = z.array(seedDistrictSchema).parse(readSeedFile("districts.json"));

  const ops: AnyBulkWriteOperation<DistrictDoc>[] = districts.map((d) => {
    const dmAuthorityContact: DmAuthorityContact = {
      name: d.dmAuthorityContact.name,
      designation: d.dmAuthorityContact.designation,
      phone: d.dmAuthorityContact.phone,
    };
    if (d.dmAuthorityContact.email) {
      dmAuthorityContact.email = d.dmAuthorityContact.email;
    }

    return {
      updateOne: {
        filter: { lgdCode: d.lgdCode },
        update: {
          $set: {
            lgdCode: d.lgdCode,
            name: d.name,
            state: d.state,
            boundary: d.boundary,
            population: d.population,
            areaSqKm: d.areaSqKm,
            primaryHazards: d.primaryHazards,
            dmAuthorityContact,
          },
        },
        upsert: true,
      },
    };
  });

  const result = await District.bulkWrite(ops);
  recordSummary("districts", result.upsertedCount, result.matchedCount);

  const all = await District.find({}, { lgdCode: 1 }).lean();
  const map = new Map<string, Types.ObjectId>();
  for (const doc of all) {
    map.set(doc.lgdCode, doc._id);
  }
  return map;
}

function requireDistrictId(
  map: Map<string, Types.ObjectId>,
  lgdCode: string,
  context: string,
): Types.ObjectId {
  const id = map.get(lgdCode);
  if (!id) {
    throw new Error(`[seed] ${context} references unknown district lgdCode "${lgdCode}"`);
  }
  return id;
}

async function seedHabitations(districtByLgdCode: Map<string, Types.ObjectId>): Promise<void> {
  const files = ["wayanad-habitations.geojson", "ganjam-habitations.geojson"];
  let inserted = 0;
  let updated = 0;

  for (const file of files) {
    const collection = seedHabitationCollectionSchema.parse(readSeedFile(file));

    const ops: AnyBulkWriteOperation<HabitationDoc>[] = collection.features.map((feature) => {
      const districtId = requireDistrictId(
        districtByLgdCode,
        feature.properties.districtLgdCode,
        `Habitation ${feature.properties.lgdHabitationCode}`,
      );
      return {
        updateOne: {
          filter: { lgdHabitationCode: feature.properties.lgdHabitationCode },
          update: {
            $set: {
              lgdHabitationCode: feature.properties.lgdHabitationCode,
              name: feature.properties.name,
              block: feature.properties.block,
              panchayat: feature.properties.panchayat,
              districtId,
              centroid: feature.geometry,
              population: feature.properties.population,
              households: feature.properties.households,
              demographics: feature.properties.demographics,
              structures: feature.properties.structures,
              access: feature.properties.access,
              livelihood: feature.properties.livelihood,
              consentStatus: feature.properties.consentStatus,
              dataProvenance: feature.properties.dataProvenance,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await Habitation.bulkWrite(ops);
    inserted += result.upsertedCount;
    updated += result.matchedCount;
  }

  recordSummary("habitations", inserted, updated);
}

async function seedHazardZones(districtByLgdCode: Map<string, Types.ObjectId>): Promise<void> {
  const files = ["wayanad-hazard-zones.geojson", "ganjam-hazard-zones.geojson"];
  let inserted = 0;
  let updated = 0;

  for (const file of files) {
    const collection = seedHazardZoneCollectionSchema.parse(readSeedFile(file));

    const ops: AnyBulkWriteOperation<HazardZoneDoc>[] = collection.features.map((feature) => {
      const districtId = requireDistrictId(
        districtByLgdCode,
        feature.properties.districtLgdCode,
        `HazardZone (${feature.properties.hazardType}/${feature.properties.zoneClass})`,
      );
      return {
        updateOne: {
          filter: {
            districtId,
            hazardType: feature.properties.hazardType,
            zoneClass: feature.properties.zoneClass,
            dataProvenance: "SYNTHETIC_DEMO",
          },
          update: {
            $set: {
              districtId,
              hazardType: feature.properties.hazardType,
              geometry: feature.geometry,
              zoneClass: feature.properties.zoneClass,
              hazardScore: feature.properties.hazardScore,
              factorContributions: new Map(Object.entries(feature.properties.factorContributions)),
              modelVersion: feature.properties.modelVersion,
              validFrom: feature.properties.validFrom,
              validTo: feature.properties.validTo,
              generatedBy: feature.properties.generatedBy,
              supersedes: null,
              dataProvenance: feature.properties.dataProvenance,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await HazardZone.bulkWrite(ops);
    inserted += result.upsertedCount;
    updated += result.matchedCount;
  }

  recordSummary("hazardZones", inserted, updated);
}

async function seedHazardEvents(districtByLgdCode: Map<string, Types.ObjectId>): Promise<void> {
  const events = z.array(seedHazardEventSchema).parse(readSeedFile("hazard-events.json"));

  const ops: AnyBulkWriteOperation<HazardEventDoc>[] = events.map((event) => {
    const districtId = requireDistrictId(
      districtByLgdCode,
      event.districtLgdCode,
      `HazardEvent "${event.name}"`,
    );
    return {
      updateOne: {
        filter: { districtId, name: event.name },
        update: {
          $set: {
            districtId,
            hazardType: event.hazardType,
            name: event.name,
            date: event.date,
            extent: event.extent,
            deaths: event.deaths,
            injured: event.injured,
            displaced: event.displaced,
            housesDamaged: event.housesDamaged,
            economicLossInrLakh: event.economicLossInrLakh,
            source: event.source,
            confidence: event.confidence,
            dataProvenance: event.dataProvenance,
            ...(event.sourceUrl ? { sourceUrl: event.sourceUrl } : {}),
          },
        },
        upsert: true,
      },
    };
  });

  const result = await HazardEvent.bulkWrite(ops);
  recordSummary("hazardEvents", result.upsertedCount, result.matchedCount);
}

async function seedRelocationSites(districtByLgdCode: Map<string, Types.ObjectId>): Promise<void> {
  const files = ["wayanad-relocation-sites.geojson", "ganjam-relocation-sites.geojson"];
  let inserted = 0;
  let updated = 0;

  for (const file of files) {
    const collection = seedRelocationSiteCollectionSchema.parse(readSeedFile(file));

    const ops: AnyBulkWriteOperation<RelocationSiteDoc>[] = collection.features.map((feature) => {
      const districtId = requireDistrictId(
        districtByLgdCode,
        feature.properties.districtLgdCode,
        `RelocationSite "${feature.properties.name}"`,
      );
      return {
        updateOne: {
          filter: { districtId, name: feature.properties.name },
          update: {
            $set: {
              districtId,
              name: feature.properties.name,
              geometry: feature.geometry,
              centroid: feature.properties.centroid,
              areaSqm: feature.properties.areaSqm,
              landOwnership: feature.properties.landOwnership,
              exclusionsPassed: feature.properties.exclusionsPassed,
              exclusionsFailed: feature.properties.exclusionsFailed,
              suitabilitySubScores: new Map(
                Object.entries(feature.properties.suitabilitySubScores),
              ),
              overallSuitabilityScore: feature.properties.overallSuitabilityScore,
              carryingCapacity: feature.properties.carryingCapacity,
              dataProvenance: feature.properties.dataProvenance,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await RelocationSite.bulkWrite(ops);
    inserted += result.upsertedCount;
    updated += result.matchedCount;
  }

  recordSummary("relocationSites", inserted, updated);
}

async function seedUsers(districtByLgdCode: Map<string, Types.ObjectId>): Promise<SeedUser[]> {
  const users = z.array(seedUserSchema).parse(readSeedFile("users.json"));

  const ops: AnyBulkWriteOperation<UserDoc>[] = [];
  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.devPassword, BCRYPT_ROUNDS);

    const scope: { state?: string; districtId?: Types.ObjectId } = {};
    if (user.scope.state) {
      scope.state = user.scope.state;
    }
    if (user.scope.districtLgdCode) {
      scope.districtId = requireDistrictId(
        districtByLgdCode,
        user.scope.districtLgdCode,
        `User ${user.email}`,
      );
    }

    ops.push({
      updateOne: {
        filter: { email: user.email },
        update: {
          $set: {
            name: user.name,
            email: user.email,
            passwordHash,
            role: user.role,
            scope,
            isActive: true,
          },
        },
        upsert: true,
      },
    });
  }

  const result = await User.bulkWrite(ops);
  recordSummary("users", result.upsertedCount, result.matchedCount);
  return users;
}

function printSummaryTable(): void {
  console.log("\n[seed] Summary:");
  console.table(summary);
  const totalDocs = summary.reduce((total, row) => total + row.total, 0);
  console.log(`[seed] Total documents processed: ${totalDocs}\n`);
}

function printUserCredentials(users: SeedUser[]): void {
  console.log(
    "[seed] Dev-only login credentials (synthetic demo DB — never reuse these passwords for anything real):",
  );
  console.table(users.map((u) => ({ role: u.role, email: u.email, password: u.devPassword })));
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("[seed] MONGODB_URI is not set — copy apps/api/.env.example to .env first.");
  }

  await connectDb(mongoUri);
  console.log(`[seed] Connected to ${mongoUri}`);

  if (isReset) {
    await resetCollections();
  }

  const districtByLgdCode = await seedDistricts();
  await seedHabitations(districtByLgdCode);
  await seedHazardZones(districtByLgdCode);
  await seedHazardEvents(districtByLgdCode);
  await seedRelocationSites(districtByLgdCode);
  const users = await seedUsers(districtByLgdCode);

  printSummaryTable();
  printUserCredentials(users);

  await disconnectDb();
}

main().catch((error: unknown) => {
  console.error("[seed] Failed:", error);
  process.exitCode = 1;
});
