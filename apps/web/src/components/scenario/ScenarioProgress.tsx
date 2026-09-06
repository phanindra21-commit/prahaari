import { useEffect, useState } from "react";
import type { HazardType } from "@punarvas/shared";

const HAZARD_LABELS: Record<HazardType, string> = {
  landslide: "landslide",
  flood: "flood",
  coastalErosion: "coastal erosion",
  cloudburst: "cloudburst",
};

interface Stage {
  label: string;
  weight: number;
}

/**
 * Stage weights are calibrated against real profiling of the scenario
 * engine (services/ml/app/engine/scenario.py — cProfile against live
 * Chamoli/Ganjam data), not guessed: per-hazard training+scoring is
 * roughly a quarter of total engine time combined, zone-boundary
 * dissolve (shapely unary_union over the whole district grid) is the
 * single largest share (~half), habitation assessment and finalization
 * are the small remainder. See docs/METHODOLOGY.md's scenario
 * performance note for the underlying numbers this mirrors — this is an
 * approximation for a progress LABEL, not a claim of exact timing.
 */
function buildStages(hazards: HazardType[]): Stage[] {
  const effectiveHazards = hazards.length > 0 ? hazards : (["landslide"] as HazardType[]);
  const perHazardWeight = 0.09;
  const stages: Stage[] = effectiveHazards.map((hazard, i) => ({
    label: `Scoring ${HAZARD_LABELS[hazard]} susceptibility (${i + 1}/${effectiveHazards.length})`,
    weight: perHazardWeight,
  }));
  stages.push({ label: "Computing hazard zone boundaries", weight: 0.5 });
  stages.push({ label: "Assessing habitation risk changes", weight: 0.18 });
  stages.push({ label: "Finalizing results", weight: 0.05 });
  return stages;
}

// Never claim the bar is fully complete before the real response lands —
// the run actually finishes whatever fraction this happens to be sitting
// at when `active` flips back to false, not a promise that reaching
// MAX_DISPLAYED_FRACTION means done.
const MAX_DISPLAYED_FRACTION = 0.94;
const TICK_MS = 150;
// A deliberately slow-side estimate of total duration to pace the bar
// against (see docs/METHODOLOGY.md's scenario performance note: the two
// largest districts measure roughly 8-11s after optimisation) — pacing
// against a faster estimate would rush to MAX_DISPLAYED_FRACTION and then
// visibly stall for several real seconds, which reads as more broken than
// an honest, steady creep toward "almost done."
const ASSUMED_TOTAL_MS = 11_000;

/** Client-side staged progress for a scenario run — there is no
 * server-push channel here (POST /scenarios/run is one synchronous
 * request, deliberately not a polled job like the zoning/pipeline runs —
 * see scenario.routes.ts's own docstring on why), so this estimates
 * which real stage is likely underway from elapsed time and known stage
 * proportions, and never overclaims completion. Purely a UX affordance
 * for "what is it doing" during a several-second wait — it plays no part
 * in the actual result, which always comes from the real response. */
export function useScenarioProgress(
  active: boolean,
  hazards: HazardType[],
): { label: string; fraction: number } {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => setElapsedMs(Date.now() - start), TICK_MS);
    return () => clearInterval(interval);
  }, [active]);

  const stages = buildStages(hazards);
  const totalWeight = stages.reduce((sum, s) => sum + s.weight, 0);
  const fractionRaw = Math.min(1, elapsedMs / ASSUMED_TOTAL_MS);

  let cumulative = 0;
  let label = stages[0]?.label ?? "Running scenario…";
  for (const stage of stages) {
    cumulative += stage.weight / totalWeight;
    label = stage.label;
    if (fractionRaw < cumulative) break;
  }

  return { label, fraction: Math.min(MAX_DISPLAYED_FRACTION, fractionRaw) };
}

export function ScenarioProgressBar({ label, fraction }: { label: string; fraction: number }): JSX.Element {
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] text-mist-300">{label}…</p>
      <div className="h-1.5 overflow-hidden rounded-sm bg-ink-900">
        <div
          className="h-full rounded-sm bg-signal transition-[width] duration-150 ease-linear"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
    </div>
  );
}
