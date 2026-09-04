import { useNavigate } from "react-router-dom";
import type { DashboardNeedsAttentionItem } from "../../lib/api";
import { PriorityBadge } from "../ui/PriorityBadge";

const HAZARD_LABELS: Record<string, string> = {
  landslide: "Landslide",
  flood: "Flood",
  coastalErosion: "Coastal erosion",
  cloudburst: "Cloudburst",
};

/** Step 9 Part 1C: top-10 by RPI. Each row links to the habitation on the
 * map and, if one exists, to its recommendation. */
export function NeedsAttentionTable({ items }: { items: DashboardNeedsAttentionItem[] | null }): JSX.Element {
  const navigate = useNavigate();

  if (items === null) {
    return (
      <div className="rounded border border-ink-600 bg-ink-800 px-4 py-3 text-xs text-mist-400">
        The needs-attention list requires assessment access, which your role does not have.
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded border border-ink-600 bg-ink-800 px-4 py-6 text-center text-sm text-mist-400">
        No Red/Orange habitations with a priority ranking yet — run the pipeline for this district.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-ink-600">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-600 bg-ink-800 text-left text-xs text-mist-400">
            <th className="px-3 py-2 font-normal">Habitation</th>
            <th className="px-3 py-2 font-normal">Priority</th>
            <th className="px-3 py-2 font-normal">Governing hazard</th>
            <th className="px-3 py-2 text-right font-normal">RPI</th>
            <th className="px-3 py-2 text-right font-normal">Population</th>
            <th className="px-3 py-2 font-normal">Site</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.habitationId}
              onClick={() =>
                navigate(
                  item.recommendationId
                    ? `/recommendations/${item.recommendationId}`
                    : `/map?habitation=${item.habitationId}`,
                )
              }
              className="cursor-pointer border-b border-ink-700 text-mist-100 last:border-b-0 hover:bg-ink-800"
            >
              <td className="px-3 py-2">{item.habitationName}</td>
              <td className="px-3 py-2">
                <PriorityBadge bucket={item.priorityBucket} />
              </td>
              <td className="px-3 py-2 text-mist-300">{HAZARD_LABELS[item.governingHazard] ?? item.governingHazard}</td>
              <td className="px-3 py-2 text-right font-mono">{item.relocationPriorityIndex.toFixed(3)}</td>
              <td className="px-3 py-2 text-right font-mono">{item.population.toLocaleString("en-IN")}</td>
              <td className="px-3 py-2 text-xs">
                {item.hasMatchedSite === null ? (
                  <span className="text-mist-500">—</span>
                ) : item.hasMatchedSite ? (
                  <span className="text-zone-green">Matched</span>
                ) : (
                  <span className="text-zone-red">No viable site</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
