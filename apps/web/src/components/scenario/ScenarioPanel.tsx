import { useState } from "react";
import { scenarioParametersConfig } from "@prahari/shared";
import type { HazardType } from "@prahari/shared";
import { useRunScenario, useScenarios, useDeleteScenario } from "../../hooks/useApi";
import { useScenarioStore } from "../../stores/scenarioStore";
import { ApiError } from "../../lib/apiClient";
import type { ScenarioParameters } from "../../lib/api";
import { useScenarioProgress, ScenarioProgressBar } from "./ScenarioProgress";

interface ScenarioPanelProps {
  districtId: string;
  hazards: HazardType[];
}

function summarizeParameters(p: ScenarioParameters): string {
  const parts: string[] = [];
  if (p.rainfallMmPer24h !== undefined) parts.push(`${p.rainfallMmPer24h} mm/24h`);
  if (p.seaLevelRiseM !== undefined) parts.push(`+${p.seaLevelRiseM} m sea level`);
  if (p.cycloneCategory !== undefined) parts.push(`Cyclone Cat ${p.cycloneCategory}`);
  return parts.join(" · ") || "No parameters";
}

export function ScenarioPanel({ districtId, hazards }: ScenarioPanelProps): JSX.Element {
  const [rainfallEnabled, setRainfallEnabled] = useState(false);
  const [rainfall, setRainfall] = useState(372);
  const [seaLevelEnabled, setSeaLevelEnabled] = useState(false);
  const [seaLevel, setSeaLevel] = useState(0.3);
  const [cycloneEnabled, setCycloneEnabled] = useState(false);
  const [cyclone, setCyclone] = useState<1 | 2 | 3 | 4 | 5>(4);
  const [customName, setCustomName] = useState("");

  const { data: scenariosData } = useScenarios(districtId);
  const runScenario = useRunScenario();
  const deleteScenario = useDeleteScenario();
  const { label: progressLabel, fraction: progressFraction } = useScenarioProgress(
    runScenario.isPending,
    hazards,
  );
  const activeScenarioId = useScenarioStore((s) => s.activeScenarioId);
  const setActiveScenario = useScenarioStore((s) => s.setActiveScenario);

  const parameters: ScenarioParameters = {};
  if (rainfallEnabled) parameters.rainfallMmPer24h = rainfall;
  if (seaLevelEnabled) parameters.seaLevelRiseM = seaLevel;
  if (cycloneEnabled) parameters.cycloneCategory = cyclone;
  const hasAnyParam = rainfallEnabled || seaLevelEnabled || cycloneEnabled;

  function applyPreset(presetId: string): void {
    const preset = scenarioParametersConfig.presets.find((p) => p.id === presetId);
    if (!preset) return;
    setRainfallEnabled(preset.parameters.rainfallMmPer24h !== undefined);
    if (preset.parameters.rainfallMmPer24h !== undefined) setRainfall(preset.parameters.rainfallMmPer24h);
    setSeaLevelEnabled(preset.parameters.seaLevelRiseM !== undefined);
    if (preset.parameters.seaLevelRiseM !== undefined) setSeaLevel(preset.parameters.seaLevelRiseM);
    setCycloneEnabled(preset.parameters.cycloneCategory !== undefined);
    if (preset.parameters.cycloneCategory !== undefined) setCyclone(preset.parameters.cycloneCategory);
    setCustomName(preset.label);
  }

  function submit(): void {
    if (!hasAnyParam) return;
    const name = customName.trim() || `Custom scenario (${summarizeParameters(parameters)})`;
    runScenario.mutate(
      { districtId, name, parameters },
      { onSuccess: (created) => setActiveScenario(created._id) },
    );
  }

  return (
    <div className="w-72 rounded border border-ink-600 bg-ink-800/95 p-3 text-xs shadow-panel backdrop-blur-sm">
      <p className="mb-2 font-medium text-mist-100">Scenario simulator</p>
      <p className="mb-3 leading-relaxed text-mist-400">
        Model a what-if event against this district&apos;s real factor data. Nothing is saved as official zoning —
        results are hypothetical until an officer acts on them through the normal review process.
      </p>

      <p className="mb-1.5 text-[11px] font-medium text-mist-300">Named presets (documented real values)</p>
      <div className="mb-3 space-y-1">
        {scenarioParametersConfig.presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.description}
            onClick={() => applyPreset(preset.id)}
            className="block w-full rounded border border-ink-600 px-2 py-1.5 text-left text-[11px] text-mist-200 transition-colors hover:border-signal-bright/60 hover:bg-signal/10"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mb-3 space-y-3 border-t border-ink-700 pt-3">
        <div>
          <label className="mb-1 flex items-center gap-2 text-[11px] font-medium text-mist-300">
            <input type="checkbox" checked={rainfallEnabled} onChange={(e) => setRainfallEnabled(e.target.checked)} />
            Rainfall (24h total)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={600}
              step={10}
              value={rainfall}
              disabled={!rainfallEnabled}
              onChange={(e) => setRainfall(Number(e.target.value))}
              className="flex-1 disabled:opacity-40"
            />
            <span className="w-16 shrink-0 text-right font-mono text-mist-200">{rainfall} mm</span>
          </div>
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-[11px] font-medium text-mist-300">
            <input type="checkbox" checked={seaLevelEnabled} onChange={(e) => setSeaLevelEnabled(e.target.checked)} />
            Sea level rise
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={seaLevel}
              disabled={!seaLevelEnabled}
              onChange={(e) => setSeaLevel(Number(e.target.value))}
              className="flex-1 disabled:opacity-40"
            />
            <span className="w-16 shrink-0 text-right font-mono text-mist-200">{seaLevel.toFixed(1)} m</span>
          </div>
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-[11px] font-medium text-mist-300">
            <input type="checkbox" checked={cycloneEnabled} onChange={(e) => setCycloneEnabled(e.target.checked)} />
            Cyclone category
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={cyclone}
              disabled={!cycloneEnabled}
              onChange={(e) => setCyclone(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
              className="flex-1 disabled:opacity-40"
            />
            <span className="w-16 shrink-0 text-right font-mono text-mist-200">Cat {cyclone}</span>
          </div>
        </div>
      </div>

      <input
        type="text"
        value={customName}
        onChange={(e) => setCustomName(e.target.value)}
        placeholder="Name this scenario…"
        className="mb-2 w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-[11px] text-mist-100 placeholder:text-mist-500"
      />

      {runScenario.error && (
        <p className="mb-2 rounded border border-zone-red/40 bg-zone-red/10 px-2 py-1 text-[10px] text-zone-red">
          {runScenario.error instanceof ApiError ? runScenario.error.message : "Scenario run failed."}
        </p>
      )}

      {runScenario.isPending && <ScenarioProgressBar label={progressLabel} fraction={progressFraction} />}

      <button
        type="button"
        disabled={!hasAnyParam || runScenario.isPending}
        onClick={submit}
        className="mb-3 w-full rounded border border-signal-bright/60 bg-signal/10 py-1.5 text-xs font-medium text-signal-bright transition-colors hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-ink-600 disabled:bg-transparent disabled:text-mist-500"
      >
        {runScenario.isPending ? "Running…" : "Run scenario"}
      </button>

      {scenariosData && scenariosData.items.length > 0 && (
        <div className="border-t border-ink-700 pt-2">
          <p className="mb-1.5 text-[11px] font-medium text-mist-300">Saved scenarios</p>
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {scenariosData.items.map((s) => (
              <li
                key={s._id}
                className={`flex items-center justify-between rounded border px-2 py-1 text-[11px] ${
                  activeScenarioId === s._id ? "border-signal-bright/60 bg-signal/10" : "border-ink-700 bg-ink-900"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveScenario(s._id)}
                  className="flex-1 truncate text-left text-mist-200 hover:text-mist-50"
                  title={summarizeParameters(s.parameters)}
                >
                  {s.name}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteScenario.mutate(s._id);
                    if (activeScenarioId === s._id) setActiveScenario(null);
                  }}
                  className="ml-1 shrink-0 text-mist-500 hover:text-zone-red"
                  aria-label={`Delete ${s.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
