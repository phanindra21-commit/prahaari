/**
 * Step 9 Part 3B — the last step of "one documented path from a clean
 * machine to a fully working demo": runs the full scoring pipeline
 * (zones -> assessments -> sites) for every seeded district, over HTTP,
 * so a rehearsal or a fresh machine never needs the hand-typed curl +
 * poll-the-job-status dance this session used repeatedly while building
 * Steps 7-9.
 *
 * Requires mongo + apps/api + services/ml already running (`npm run dev`
 * from the repo root, or the individual `dev:*` scripts) and the
 * database already seeded/grid-generated/factor-ingested — this script
 * only calls the already-live HTTP API, it does not touch MongoDB or the
 * filesystem directly.
 *
 * Usage (from apps/api): npm run run-pipeline
 */
import "dotenv/config";
import { env } from "../lib/env";

const API_BASE_URL = `http://localhost:${env.PORT}/api/v1`;
const SUPERADMIN_EMAIL = "superadmin@punarvas.gov.in";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

interface District {
  _id: string;
  name: string;
}

interface JobStatus {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  progressPercent: number;
  error?: string;
}

async function login(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SUPERADMIN_EMAIL, password: env.SEED_DEFAULT_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(
      `[run-pipeline] login as ${SUPERADMIN_EMAIL} failed (HTTP ${res.status}) — has \`npm run seed\` been run?`,
    );
  }
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

async function listDistricts(token: string): Promise<District[]> {
  const res = await fetch(`${API_BASE_URL}/districts`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`[run-pipeline] GET /districts failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { items: District[] };
  return body.items;
}

async function runPipelineForDistrict(token: string, district: District): Promise<void> {
  const runRes = await fetch(`${API_BASE_URL}/pipeline/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ districtId: district._id }),
  });
  if (!runRes.ok) {
    const text = await runRes.text().catch(() => "");
    throw new Error(`[run-pipeline] POST /pipeline/run for ${district.name} failed (HTTP ${runRes.status}): ${text}`);
  }
  const { jobId } = (await runRes.json()) as { jobId: string };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const statusRes = await fetch(`${API_BASE_URL}/zoning/runs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = (await statusRes.json()) as JobStatus;
    process.stdout.write(`\r[run-pipeline] ${district.name}: ${status.status} (${status.progressPercent}%)   `);

    if (status.status === "SUCCEEDED") {
      console.log();
      return;
    }
    if (status.status === "FAILED") {
      console.log();
      throw new Error(`[run-pipeline] ${district.name} pipeline run failed: ${status.error ?? "unknown error"}`);
    }
    if (Date.now() > deadline) {
      console.log();
      throw new Error(`[run-pipeline] ${district.name} pipeline run did not finish within ${POLL_TIMEOUT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  console.log(`[run-pipeline] connecting to ${API_BASE_URL}`);
  const token = await login();
  const districts = await listDistricts(token);
  if (districts.length === 0) {
    throw new Error("[run-pipeline] No districts found — run `npm run seed` first.");
  }
  console.log(`[run-pipeline] running the pipeline for ${districts.length} district(s): ${districts.map((d) => d.name).join(", ")}`);

  for (const district of districts) {
    await runPipelineForDistrict(token, district);
  }
  console.log("[run-pipeline] done — every district's hazard zones, assessments, and site recommendations are live.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
