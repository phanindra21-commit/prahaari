/**
 * Persistent dev MongoDB — Step 9 Part 3A.
 *
 * The previous dev setup (apps/api/dev-mongo.tmp.js, deleted) used
 * `MongoMemoryServer.create()` with its default temp directory: every
 * process restart wiped all seeded/scored data. That is fatal on demo
 * day if the API crashes or the machine sleeps between rehearsal and
 * the real thing.
 *
 * This script resolves the real mongod binary mongodb-memory-server
 * already manages (downloaded once via its postinstall step — see
 * node_modules/.cache/mongodb-memory-server/, populated by `npm install`
 * on any machine, not just this one) and spawns it directly against a
 * fixed, gitignored, ON-DISK dbpath (data/db/, repo root) — bypassing
 * MongoMemoryServer's own start/stop lifecycle entirely, so there is no
 * wrapper code path that could ever call its cleanup-and-delete-dbPath
 * behavior. Data survives every restart, exactly like a real deployment.
 *
 * Usage: npm run dev:mongo (wired into `npm run dev` via concurrently,
 * apps/api/package.json). Stop with Ctrl+C — mongod (WiredTiger) is
 * crash-safe, so an ungraceful stop on Windows (which has no true POSIX
 * signal delivery) never risks the data files.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { MongoBinary } from "mongodb-memory-server";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const DB_PATH = join(REPO_ROOT, "data", "db");
const PORT = 27117;

async function main(): Promise<void> {
  mkdirSync(DB_PATH, { recursive: true });

  const binaryPath = await MongoBinary.getPath({});
  console.log(`[dev-mongo] binary: ${binaryPath}`);
  console.log(`[dev-mongo] dbpath: ${DB_PATH} (persistent — survives restarts)`);

  const child = spawn(binaryPath, ["--dbpath", DB_PATH, "--port", String(PORT), "--bind_ip", "127.0.0.1"], {
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
  child.on("error", (err) => {
    console.error("[dev-mongo] failed to start mongod", err);
    process.exit(1);
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

main().catch((err) => {
  console.error("[dev-mongo] failed to start", err);
  process.exit(1);
});
