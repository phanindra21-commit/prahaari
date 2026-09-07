import type { HazardType } from "@prahari/shared";

const HAZARD_LABELS: Record<HazardType, string> = {
  landslide: "Landslide",
  flood: "Flood",
  coastalErosion: "Coastal erosion",
  cloudburst: "Cloudburst",
};

interface LayerPanelProps {
  availableHazards: HazardType[];
  visibleHazards: Set<HazardType>;
  onToggleHazard: (hazard: HazardType) => void;
  showHabitations: boolean;
  onToggleHabitations: () => void;
  showSites: boolean;
  onToggleSites: () => void;
}

function Checkbox({
  checked,
  onChange,
  label,
  swatch,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  swatch?: JSX.Element;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-mist-200 hover:text-mist-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 rounded-sm border-ink-500 bg-ink-900 accent-signal"
      />
      {swatch}
      {label}
    </label>
  );
}

export function LayerPanel({
  availableHazards,
  visibleHazards,
  onToggleHazard,
  showHabitations,
  onToggleHabitations,
  showSites,
  onToggleSites,
}: LayerPanelProps): JSX.Element {
  return (
    <div className="w-56 rounded border border-ink-600 bg-ink-800/95 p-3 shadow-panel backdrop-blur-sm">
      <p className="mb-1.5 text-xs text-mist-400">Hazard zones</p>
      {availableHazards.map((hazard) => (
        <Checkbox
          key={hazard}
          checked={visibleHazards.has(hazard)}
          onChange={() => onToggleHazard(hazard)}
          label={HAZARD_LABELS[hazard]}
        />
      ))}

      <div className="my-2 border-t border-ink-600" />

      <Checkbox checked={showHabitations} onChange={onToggleHabitations} label="Habitations" />
      <Checkbox checked={showSites} onChange={onToggleSites} label="Candidate relocation sites" />
    </div>
  );
}
