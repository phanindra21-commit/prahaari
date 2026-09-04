const ZONE_ROWS: Array<{ label: string; color: string }> = [
  { label: "Red — highest susceptibility", color: "#C6483C" },
  { label: "Orange", color: "#CE8A3E" },
  { label: "Yellow", color: "#C9B454" },
  { label: "Green — lowest susceptibility", color: "#4C9F73" },
];

const BUCKET_ROWS: Array<{ label: string; color: string }> = [
  { label: "Immediate priority", color: "#C6483C" },
  { label: "Short-term priority", color: "#CE8A3E" },
  { label: "Medium-term priority", color: "#2FA9A0" },
  { label: "Not bucketed (Yellow/Green)", color: "#5C6B78" },
];

export function ZoneLegend(): JSX.Element {
  return (
    <div className="w-56 rounded border border-ink-600 bg-ink-800/95 p-3 text-xs shadow-panel backdrop-blur-sm">
      <p className="mb-1.5 text-mist-400">Zone class</p>
      {ZONE_ROWS.map((row) => (
        <div key={row.label} className="flex items-center gap-2 py-0.5 text-mist-200">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: row.color }} />
          {row.label}
        </div>
      ))}

      <p className="mb-1.5 mt-3 text-mist-400">Habitation priority</p>
      {BUCKET_ROWS.map((row) => (
        <div key={row.label} className="flex items-center gap-2 py-0.5 text-mist-200">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
          {row.label}
        </div>
      ))}
      <p className="mt-2 text-mist-400">Habitation size = population</p>
    </div>
  );
}
