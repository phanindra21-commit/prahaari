import { useScenarioStore } from "../../stores/scenarioStore";

const VIEW_LABELS: Record<string, string> = {
  baseline: "Baseline (current real state)",
  scenario: "Scenario (hypothetical)",
};

interface ScenarioModeBannerProps {
  scenarioName: string;
}

/** Step 8 Part 2E: unmistakable while scenario mode is active — this is
 * a what-if projection, not the official zoning. Nothing rendered while
 * this banner is visible has changed any HazardZone/Assessment document;
 * see scenarioRunner.ts's module docstring. */
export function ScenarioModeBanner({ scenarioName }: ScenarioModeBannerProps): JSX.Element {
  const viewMode = useScenarioStore((s) => s.viewMode);
  const toggleViewMode = useScenarioStore((s) => s.toggleViewMode);
  const setActiveScenario = useScenarioStore((s) => s.setActiveScenario);

  return (
    <div className="pointer-events-auto rounded border border-zone-orange/60 bg-ink-900/95 px-3 py-2 shadow-panel backdrop-blur-sm">
      <div className="flex items-start gap-2">
        <span className="mt-1 flex h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-zone-orange" aria-hidden />
        <div className="min-w-0 flex-1 text-xs leading-tight">
          <p className="font-semibold text-zone-orange">
            SCENARIO MODE — &ldquo;{scenarioName}&rdquo; is hypothetical and has NOT changed the official zoning
          </p>
          <p className="mt-0.5 text-mist-300">
            Viewing: <span className="font-medium text-mist-100">{VIEW_LABELS[viewMode]}</span> — advisory only,
            for planning discussion.
          </p>
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={toggleViewMode}
          className="flex-shrink-0 rounded border border-zone-orange/60 px-2 py-1 text-[11px] font-medium text-zone-orange hover:bg-zone-orange/20"
        >
          Show {viewMode === "baseline" ? "scenario" : "baseline"}
        </button>
        <button
          type="button"
          onClick={() => setActiveScenario(null)}
          className="flex-shrink-0 rounded border border-ink-500 px-2 py-1 text-[11px] text-mist-300 hover:text-mist-100"
        >
          Exit scenario mode
        </button>
      </div>
    </div>
  );
}
