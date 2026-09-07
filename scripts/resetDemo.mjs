/**
 * ONE command that takes the app from ANY state — empty database, half-run
 * pipeline, wiped scores, whatever — to fully seeded, fully scored,
 * demo-ready across all three pilot districts (Wayanad, Ganjam, Chamoli).
 *
 * Chains the same five steps the README's "From a Clean Machine to a Full
 * Working Demo" section already documents as separate commands, in order:
 * seed -> generate-grid -> derive_factors.py -> ingest-factors -> run-pipeline.
 * Every one of those five is independently idempotent (seed: natural-key
 * upserts, scoring fields $setOnInsert-only since the seed-script fix that
 * shipped alongside this script; generate-grid/ingest-factors: upsert by
 * h3Index; derive_factors.py: pure recompute-and-overwrite; run-pipeline:
 * re-scores every district from scratch) — so running this on a database
 * that is already fully scored is a safe, cheap no-op-ish confirmation
 * pass, not a risk.
 *
 * Requires mongo + apps/api + services/ml already running (`npm run dev`
 * in another terminal) — this script only seeds data and calls the live
 * HTTP pipeline API, it does not start any servers itself.
 *
 * Usage (from repo root): npm run demo:reset
 */
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const mlPython = isWindows ? "venv\\Scripts\\python" : "venv/bin/python";

const steps = [
  {
    label: "1/5 Seed districts, habitations, hazard zones/events, relocation sites, and demo users",
    command: npmCmd,
    args: ["run", "seed", "--workspace=@punarvas/api"],
  },
  {
    label: "2/5 Fill every district's boundary with an H3 grid",
    command: npmCmd,
    args: ["run", "generate-grid", "--workspace=@punarvas/api"],
  },
  {
    label: "3/5 Derive synthetic-but-spatially-coherent causative factors",
    command: mlPython,
    args: ["scripts/derive_factors.py"],
    cwd: "services/ml",
  },
  {
    label: "4/5 Load those factors onto every GridCell",
    command: npmCmd,
    args: ["run", "ingest-factors", "--workspace=@punarvas/api"],
  },
  {
    label: "5/5 Run the full pipeline (zoning -> assessments -> site matching) for every district",
    command: npmCmd,
    args: ["run", "run-pipeline", "--workspace=@punarvas/api"],
  },
];

console.log("[demo:reset] Requires mongo + apps/api + services/ml already running (`npm run dev`).\n");

for (const step of steps) {
  console.log(`[demo:reset] ${step.label}`);
  // Fixed, hardcoded arguments only (no user input reaches this) — joined
  // into one command string rather than passed as an args array, since
  // Node deprecates (and warns on) combining shell:true with an args array.
  const result = spawnSync(`${step.command} ${step.args.join(" ")}`, {
    stdio: "inherit",
    shell: true,
    cwd: step.cwd,
  });
  if (result.status !== 0) {
    console.error(
      `\n[demo:reset] FAILED at "${step.label}" (exit code ${result.status ?? "unknown"}). ` +
        "Nothing after this step ran. Fix the error above and re-run `npm run demo:reset` — every step is safe to repeat.",
    );
    process.exit(result.status ?? 1);
  }
}

console.log(
  "\n[demo:reset] Done — all three districts are fully seeded and scored. Open http://localhost:5173 and sign in.",
);
