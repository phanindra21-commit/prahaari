import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RecommendationStatus, RelocationPriorityBucket, EscalationStatus } from "@punarvas/shared";
import { useDistrictStore } from "../stores/districtStore";
import { useAuthStore } from "../stores/authStore";
import { hasPermission } from "../lib/permissions";
import { useDistricts, useRecommendations } from "../hooks/useApi";
import { PriorityBadge } from "../components/ui/PriorityBadge";
import { RecommendationStatusBadge } from "../components/ui/RecommendationStatusBadge";
import { DistrictCapacityBanner } from "../components/decisions/DistrictCapacityBanner";

const BUCKET_FILTERS: Array<{ label: string; value: RelocationPriorityBucket | undefined }> = [
  { label: "All buckets", value: undefined },
  { label: "Immediate", value: "Immediate" },
  { label: "Short-term", value: "ShortTerm" },
];

const STATUS_FILTERS: Array<{ label: string; value: RecommendationStatus | undefined }> = [
  { label: "All statuses", value: undefined },
  { label: "Pending review", value: "PENDING_REVIEW" },
  { label: "Approved", value: "APPROVED" },
  { label: "Modified", value: "MODIFIED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "Deferred", value: "DEFERRED" },
];

const ESCALATION_FILTERS: Array<{ label: string; value: EscalationStatus | undefined }> = [
  { label: "All", value: undefined },
  { label: "Escalated", value: "ESCALATED" },
];

/** Step 7 Commit 3A: the officer review queue — every system-generated
 * habitation-to-site recommendation for the selected district (TopBar's
 * district switcher), filterable by priority bucket and decision status. */
export function ReviewQueuePage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const canReadRecommendations = user ? hasPermission(user.role, "recommendation:read") : false;
  const selectedDistrictId = useDistrictStore((s) => s.selectedDistrictId);
  const { data: districtsData } = useDistricts();
  const district = districtsData?.items.find((d) => d._id === selectedDistrictId);

  const [bucket, setBucket] = useState<RelocationPriorityBucket | undefined>(undefined);
  const [status, setStatus] = useState<RecommendationStatus | undefined>(undefined);
  const [escalationStatus, setEscalationStatus] = useState<EscalationStatus | undefined>(undefined);
  const { data, isLoading, isError } = useRecommendations({
    districtId: canReadRecommendations ? (selectedDistrictId ?? undefined) : undefined,
    priorityBucket: bucket,
    status,
    escalationStatus,
  });
  const navigate = useNavigate();

  // The nav bar already hides the "Review queue" link for a role without
  // recommendation:read (TopBar.tsx) — this guards direct URL navigation
  // (bookmark, back button, typed URL), which would otherwise still fire
  // the query above and land on a raw "Could not load" error instead of
  // an honest access-restricted message.
  if (!canReadRecommendations) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="max-w-md text-center text-sm text-mist-300">
          Access restricted. Your role does not include permission to view the officer review queue.
        </p>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold text-mist-50">Officer review queue</h1>
          {data && (
            <span className="text-xs text-mist-400">
              {data.items.length} matching {data.items.length === 1 ? "record" : "records"}
              {bucket ? ` · ${BUCKET_FILTERS.find((f) => f.value === bucket)?.label}` : ""}
              {status ? ` · ${STATUS_FILTERS.find((f) => f.value === status)?.label}` : ""}
              {escalationStatus ? ` · ${ESCALATION_FILTERS.find((f) => f.value === escalationStatus)?.label}` : ""}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
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
          <span className="mx-1 self-center text-ink-500">|</span>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatus(f.value)}
              className={`rounded border px-2 py-1 text-xs transition-colors ${
                status === f.value
                  ? "border-signal bg-signal/10 text-signal-bright"
                  : "border-ink-600 text-mist-300 hover:text-mist-100"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="mx-1 self-center text-ink-500">|</span>
          {ESCALATION_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setEscalationStatus(f.value)}
              className={`rounded border px-2 py-1 text-xs transition-colors ${
                escalationStatus === f.value
                  ? "border-zone-orange bg-zone-orange/10 text-zone-orange"
                  : "border-ink-600 text-mist-300 hover:text-mist-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {selectedDistrictId && district && (
        <DistrictCapacityBanner districtId={selectedDistrictId} districtName={district.name} />
      )}

      {!selectedDistrictId && (
        <p className="text-sm text-mist-300">
          No district is in your assigned scope yet. Contact your administrator to be assigned to a district.
        </p>
      )}

      {isLoading && <p className="text-sm text-mist-300">Loading…</p>}

      {isError && <p className="text-sm text-zone-red">Could not load the review queue.</p>}

      {data && (
        <div className="overflow-hidden rounded border border-ink-600">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-600 bg-ink-800 text-left text-xs text-mist-400">
                <th className="px-3 py-2 font-normal">Habitation</th>
                <th className="px-3 py-2 font-normal">Priority</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 font-normal">Top site</th>
                <th className="px-3 py-2 text-right font-normal">Capacity headroom</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((rec) => {
                const topSite = rec.candidateSites[0]?.relocationSiteId ?? rec.selectedSiteId;
                const headroom = topSite?.carryingCapacity
                  ? topSite.carryingCapacity.effectiveCapacity - rec.estimatedHouseholdsToMove
                  : null;
                return (
                  <tr
                    key={rec._id}
                    onClick={() => navigate(`/recommendations/${rec._id}`)}
                    className="cursor-pointer border-b border-ink-700 text-mist-100 last:border-b-0 hover:bg-ink-800"
                  >
                    <td className="px-3 py-2">
                      {rec.habitationId.name}
                      <span className="ml-1.5 text-xs text-mist-400">
                        ({rec.estimatedHouseholdsToMove} households)
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <PriorityBadge bucket={rec.priorityBucket} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <RecommendationStatusBadge status={rec.status} />
                        {rec.escalation.status === "ESCALATED" && (
                          <span
                            className="rounded border border-zone-orange/50 bg-zone-orange/10 px-1 py-0.5 text-[10px] font-medium text-zone-orange"
                            title="Escalated to State"
                          >
                            ESCALATED
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-mist-300">
                      {topSite?.name ?? "—"}
                      {rec.phasing.length === 0 && (
                        <span className="ml-1.5 rounded border border-zone-red/40 bg-zone-red/10 px-1 py-0.5 text-[10px] text-zone-red">
                          unmatched
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {headroom === null ? (
                        "—"
                      ) : (
                        <span className={headroom < 0 ? "text-zone-red" : "text-mist-200"}>
                          {headroom >= 0 ? "+" : ""}
                          {Math.round(headroom)} hh
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-mist-400">
              No recommendations match this filter for the selected district.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
