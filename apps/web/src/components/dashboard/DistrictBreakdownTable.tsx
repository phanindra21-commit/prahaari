import type { DashboardDistrict } from "../../lib/api";

interface DistrictBreakdownTableProps {
  districts: DashboardDistrict[];
  selectedDistrictId: string;
  onSelect: (districtId: string) => void;
}

/** Step 9 Part 1E: STATE_ADMIN/SUPER_ADMIN's per-district breakdown — a
 * row per district in scope; selecting one drives the detail sections
 * (charts/needs-attention/recent activity) below. */
export function DistrictBreakdownTable({
  districts,
  selectedDistrictId,
  onSelect,
}: DistrictBreakdownTableProps): JSX.Element {
  return (
    <div className="overflow-hidden rounded border border-ink-600">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-600 bg-ink-800 text-left text-xs text-mist-400">
            <th className="px-3 py-2 font-normal">District</th>
            <th className="px-3 py-2 text-right font-normal">Assessed</th>
            <th className="px-3 py-2 text-right font-normal">Red</th>
            <th className="px-3 py-2 text-right font-normal">Orange</th>
            <th className="px-3 py-2 text-right font-normal">Immediate</th>
            <th className="px-3 py-2 text-right font-normal">No viable site</th>
          </tr>
        </thead>
        <tbody>
          {districts.map((d) => (
            <tr
              key={d.districtId}
              onClick={() => onSelect(d.districtId)}
              className={`cursor-pointer border-b border-ink-700 text-mist-100 last:border-b-0 hover:bg-ink-800 ${
                d.districtId === selectedDistrictId ? "bg-ink-800" : ""
              }`}
            >
              <td className="px-3 py-2">
                {d.districtId === selectedDistrictId && <span className="mr-1.5 text-signal-bright">●</span>}
                {d.districtName}
              </td>
              <td className="px-3 py-2 text-right font-mono">{d.habitationsAssessed}</td>
              <td className="px-3 py-2 text-right font-mono text-zone-red">{d.redCount}</td>
              <td className="px-3 py-2 text-right font-mono text-zone-orange">{d.orangeCount}</td>
              <td className="px-3 py-2 text-right font-mono">{d.bucketCounts.Immediate}</td>
              <td className="px-3 py-2 text-right font-mono">
                {d.capacityShortfall === null ? (
                  <span className="text-mist-500">—</span>
                ) : (
                  <span className={d.capacityShortfall.noViableSite > 0 ? "text-zone-red" : "text-mist-300"}>
                    {d.capacityShortfall.noViableSite}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
