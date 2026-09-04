import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RelocationPriorityBucket } from "@punarvas/shared";
import { useDistrictStore } from "../stores/districtStore";
import { usePriorities } from "../hooks/useApi";
import { ZoneBadge } from "../components/ui/ZoneBadge";
import { PriorityBadge } from "../components/ui/PriorityBadge";

const BUCKET_FILTERS: Array<{ label: string; value: RelocationPriorityBucket | undefined }> = [
  { label: "All", value: undefined },
  { label: "Immediate", value: "Immediate" },
  { label: "Short-term", value: "ShortTerm" },
  { label: "Medium-term", value: "MediumTerm" },
];

const HAZARD_LABELS: Record<string, string> = {
  landslide: "Landslide",
  flood: "Flood",
  coastalErosion: "Coastal erosion",
  cloudburst: "Cloudburst",
};

export function PrioritiesPage(): JSX.Element {
  const selectedDistrictId = useDistrictStore((s) => s.selectedDistrictId);
  const [bucket, setBucket] = useState<RelocationPriorityBucket | undefined>(undefined);
  const { data, isLoading } = usePriorities(selectedDistrictId ?? undefined, bucket);
  const navigate = useNavigate();

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-sm font-semibold text-mist-50">Priority worklist</h1>
        <div className="flex gap-1">
          {BUCKET_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setBucket(f.value)}
              className={`rounded border px-2 py-1 text-xs transition-colors ${
                bucket === f.value
                  ? "border-signal bg-signal/10 text-signal-bright"
                  : "border-ink-600 text-mist-300 hover:text-mist-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-sm text-mist-300">Loading…</p>}

      {data && (
        <div className="overflow-hidden rounded border border-ink-600">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-600 bg-ink-800 text-left text-xs text-mist-400">
                <th className="px-3 py-2 font-normal">Habitation</th>
                <th className="px-3 py-2 font-normal">Zone</th>
                <th className="px-3 py-2 font-normal">Governing hazard</th>
                <th className="px-3 py-2 font-normal">Priority</th>
                <th className="px-3 py-2 text-right font-normal">RPI</th>
                <th className="px-3 py-2 font-normal">Top factor</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr
                  key={item.habitationId}
                  onClick={() => navigate(`/map?habitation=${item.habitationId}`)}
                  className="cursor-pointer border-b border-ink-700 text-mist-100 last:border-b-0 hover:bg-ink-800"
                >
                  <td className="px-3 py-2">{item.habitationName}</td>
                  <td className="px-3 py-2">
                    <ZoneBadge zoneClass={item.overallZoneClass} />
                  </td>
                  <td className="px-3 py-2 text-mist-300">{HAZARD_LABELS[item.governingHazard]}</td>
                  <td className="px-3 py-2">
                    <PriorityBadge bucket={item.priorityBucket} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{item.relocationPriorityIndex.toFixed(3)}</td>
                  <td className="px-3 py-2 text-xs text-mist-400">{item.topFactor?.label ?? item.topFactor?.factor ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-mist-400">
              No Red/Orange habitations match this filter for the selected district.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
