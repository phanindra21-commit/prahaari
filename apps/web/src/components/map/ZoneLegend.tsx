import { ZONE_COLORS, BUCKET_COLORS, UNBUCKETED_COLOR } from "./mapStyle";

const ZONE_ROWS: Array<{ label: string; color: string }> = [
  { label: "Red — highest susceptibility", color: ZONE_COLORS.Red! },
  { label: "Orange", color: ZONE_COLORS.Orange! },
  { label: "Yellow", color: ZONE_COLORS.Yellow! },
  { label: "Green — lowest susceptibility", color: ZONE_COLORS.Green! },
];

const BUCKET_ROWS: Array<{ label: string; color: string }> = [
  { label: "Immediate priority", color: BUCKET_COLORS.Immediate! },
  { label: "Short-term priority", color: BUCKET_COLORS.ShortTerm! },
  { label: "Medium-term priority", color: BUCKET_COLORS.MediumTerm! },
  { label: "Not bucketed (Yellow/Green)", color: UNBUCKETED_COLOR },
];

/** Step 7 Commit 3F: ring color around a habitation dot once it has a
 * recorded decision — see MapView.tsx's DECISION_RING_COLORS. */
const DECISION_ROWS: Array<{ label: string; color: string }> = [
  { label: "Approved", color: ZONE_COLORS.Green! },
  { label: "Modified", color: ZONE_COLORS.Orange! },
  { label: "Rejected", color: ZONE_COLORS.Red! },
  { label: "Deferred", color: ZONE_COLORS.Yellow! },
];

export function ZoneLegend({ showDecisionRing = false }: { showDecisionRing?: boolean }): JSX.Element {
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

      {showDecisionRing && (
        <>
          <p className="mb-1.5 mt-3 text-mist-400">Decision ring (Step 7 review queue)</p>
          {DECISION_ROWS.map((row) => (
            <div key={row.label} className="flex items-center gap-2 py-0.5 text-mist-200">
              <span
                className="h-2.5 w-2.5 rounded-full border-2 bg-transparent"
                style={{ borderColor: row.color }}
              />
              {row.label}
            </div>
          ))}
        </>
      )}
      <p className="mt-2 text-mist-400">Habitation size = population</p>
    </div>
  );
}
