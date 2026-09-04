import type { ScenarioRun } from "../../lib/api";

const HAZARD_LABELS: Record<string, string> = {
  landslide: "Landslide",
  flood: "Flood",
  coastalErosion: "Coastal erosion",
  cloudburst: "Cloudburst",
};

/** Step 8 Part 2E/2B: the delta is the story — this renders counts, not
 * a restatement of absolute totals. "142 more cells go Red and 6 more
 * habitations enter Immediate" is the shape of finding this surfaces. */
export function ScenarioSummary({ scenario }: { scenario: ScenarioRun }): JSX.Element {
  const affectedHazards = scenario.hazardSummaries.filter((s) => s.affected);
  const unaffectedHazards = scenario.hazardSummaries.filter((s) => !s.affected);
  const totalCellsChanged = scenario.hazardSummaries.reduce((sum, s) => sum + s.cellsChanged, 0);
  const totalNewlyRed = scenario.hazardSummaries.reduce((sum, s) => sum + s.newlyRedCells, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-ink-600 bg-ink-800 p-2 text-center">
          <p className="font-mono text-lg font-semibold text-zone-orange">{totalCellsChanged}</p>
          <p className="text-[10px] text-mist-400">cells change class</p>
        </div>
        <div className="rounded border border-ink-600 bg-ink-800 p-2 text-center">
          <p className="font-mono text-lg font-semibold text-zone-red">{totalNewlyRed}</p>
          <p className="text-[10px] text-mist-400">cells newly Red</p>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-medium text-mist-300">Per-hazard cell shift</p>
        <div className="space-y-1">
          {affectedHazards.map((s) => (
            <div key={s.hazardType} className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs">
              <div className="mb-0.5 flex items-center justify-between">
                <span className="text-mist-100">{HAZARD_LABELS[s.hazardType]}</span>
                <span className="font-mono text-mist-300">
                  {s.cellsChanged} changed{s.newlyRedCells > 0 ? `, +${s.newlyRedCells} Red` : ""}
                </span>
              </div>
              <div className="flex gap-2 font-mono text-[10px] text-mist-400">
                <span>
                  Red {s.baselineZoneCounts.Red}→{s.scenarioZoneCounts.Red}
                </span>
                <span>
                  Orange {s.baselineZoneCounts.Orange}→{s.scenarioZoneCounts.Orange}
                </span>
                <span>
                  Yellow {s.baselineZoneCounts.Yellow}→{s.scenarioZoneCounts.Yellow}
                </span>
                <span>
                  Green {s.baselineZoneCounts.Green}→{s.scenarioZoneCounts.Green}
                </span>
              </div>
            </div>
          ))}
          {unaffectedHazards.length > 0 && (
            <p className="px-1 text-[10px] text-mist-500">
              Not affected by this scenario: {unaffectedHazards.map((s) => HAZARD_LABELS[s.hazardType]).join(", ")}
            </p>
          )}
        </div>
      </div>

      {scenario.habitationsEnteringImmediate.length > 0 ? (
        <div className="rounded border border-zone-red/50 bg-zone-red/10 p-2">
          <p className="mb-1 text-xs font-semibold text-zone-red">
            {scenario.habitationsEnteringImmediate.length} habitation
            {scenario.habitationsEnteringImmediate.length === 1 ? "" : "s"} newly enter Immediate priority
          </p>
          <ul className="space-y-0.5 text-xs text-mist-200">
            {scenario.habitationsEnteringImmediate.map((name) => (
              <li key={name}>• {name}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded border border-ink-600 bg-ink-800 px-2 py-1.5 text-[11px] text-mist-400">
          No habitation newly enters Immediate priority under this scenario.
        </p>
      )}

      {scenario.habitationDeltas.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-mist-300">
            All habitation changes ({scenario.habitationDeltas.length})
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {scenario.habitationDeltas.map((d) => (
              <li
                key={d.habitationId}
                className="flex items-center justify-between rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px]"
              >
                <span className="text-mist-200">{d.habitationName}</span>
                <span className="font-mono text-mist-400">
                  {d.baselineOverallZoneClass}→{d.scenarioOverallZoneClass}
                  {d.scenarioPriorityBucket !== d.baselinePriorityBucket
                    ? ` · ${d.baselinePriorityBucket ?? "none"}→${d.scenarioPriorityBucket ?? "none"}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-mist-500">
        Computed in {scenario.runtimeSeconds.toFixed(1)}s · {scenario.modelVersion}
      </p>
    </div>
  );
}
