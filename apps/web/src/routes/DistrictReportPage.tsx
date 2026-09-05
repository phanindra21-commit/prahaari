import { useParams } from "react-router-dom";
import {
  useDistricts,
  useDashboardSummary,
  usePriorities,
  useHabitationsGeoJSON,
  useRecommendations,
  useDistrictDecisions,
} from "../hooks/useApi";

const HAZARD_LABELS: Record<string, string> = {
  landslide: "Landslide",
  flood: "Flood",
  coastalErosion: "Coastal erosion",
  cloudburst: "Cloudburst",
};

const BUCKET_LABELS: Record<string, string> = {
  Immediate: "Immediate",
  ShortTerm: "Short-term",
  MediumTerm: "Medium-term",
};

const ACTION_LABELS: Record<string, string> = {
  APPROVE: "Approved",
  MODIFY: "Modified",
  REJECT: "Rejected",
  DEFER: "Deferred",
};

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className="mb-2 mt-6 border-b-2 border-black pb-1 text-base font-semibold">{children}</h2>;
}

/** Step 9 Part 2A: the district situation report — a print-optimized page
 * (window.print(), no server-side PDF generator: "prefer the simpler
 * option; a broken PDF generator on demo day is worse than a good print
 * stylesheet"). Deliberately light-themed regardless of the app's dark
 * theme — this is a document meant to be read on paper or saved as a
 * PDF, not a screen panel. */
export function DistrictReportPage(): JSX.Element {
  const { districtId } = useParams<{ districtId: string }>();
  const { data: districtsData } = useDistricts();
  const district = districtsData?.items.find((d) => d._id === districtId);
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary(districtId);
  const { data: priorities, isLoading: prioritiesLoading } = usePriorities(districtId);
  const { data: habitationsGeo } = useHabitationsGeoJSON(districtId);
  const { data: recommendations } = useRecommendations({ districtId });
  const { data: decisions } = useDistrictDecisions(districtId);

  const isLoading = summaryLoading || prioritiesLoading;
  const block = summary?.districts[0];

  const populationByHabitationId = new Map(
    (habitationsGeo?.features ?? []).map((f) => [f.properties.id, f.properties.population]),
  );

  const latestModelVersion = priorities?.items[0]?.computedAt
    ? { computedAt: priorities.items[0].computedAt }
    : null;
  const recommendationModelVersion = recommendations?.items[0]?.modelVersion ?? null;

  if (isLoading || !district || !block) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-black">
        <p className="text-sm">Loading report…</p>
      </div>
    );
  }

  return (
    <div className="print-report h-full overflow-y-auto bg-white text-black">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-ink-600 bg-ink-900 px-4 py-2">
        <p className="text-xs text-mist-300">Print preview — {district.name} district situation report</p>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded border border-signal-bright/60 bg-signal/10 px-3 py-1.5 text-xs font-medium text-signal-bright hover:bg-signal/20"
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="mx-auto max-w-3xl px-8 py-6 text-sm leading-relaxed">
        <p className="mb-1 inline-block rounded border border-black px-2 py-0.5 font-mono text-[10px] font-semibold">
          SYNTHETIC_DEMO
        </p>
        <h1 className="text-xl font-bold">District Situation Report — {district.name}, {district.state}</h1>
        <p className="text-xs text-gray-600">
          Generated {new Date().toLocaleString("en-IN")} · Population {district.population.toLocaleString("en-IN")} ·
          Area {district.areaSqKm.toLocaleString("en-IN")} km² · Primary hazards:{" "}
          {district.primaryHazards.map((h) => HAZARD_LABELS[h] ?? h).join(", ")}
        </p>

        <div className="mt-3 rounded border border-black bg-gray-50 p-3 text-xs">
          <strong>Advisory only.</strong> Every recommendation in this report requires review and written
          justification from a competent authority before it takes effect. Nothing in this document constitutes an
          approved relocation order.
        </div>

        <SectionTitle>Summary</SectionTitle>
        <table className="w-full border-collapse text-xs">
          <tbody>
            <tr>
              <td className="border border-gray-400 px-2 py-1 font-medium">Habitations assessed</td>
              <td className="border border-gray-400 px-2 py-1">{block.habitationsAssessed}</td>
              <td className="border border-gray-400 px-2 py-1 font-medium">Red / Orange zone</td>
              <td className="border border-gray-400 px-2 py-1">
                {block.redCount} / {block.orangeCount}
              </td>
            </tr>
            <tr>
              <td className="border border-gray-400 px-2 py-1 font-medium">Immediate priority</td>
              <td className="border border-gray-400 px-2 py-1">
                {block.bucketCounts.Immediate} habitations, {block.immediatePopulation.toLocaleString("en-IN")}{" "}
                people, {block.immediateHouseholds.toLocaleString("en-IN")} households
              </td>
              <td className="border border-gray-400 px-2 py-1 font-medium">Short-term / Medium-term</td>
              <td className="border border-gray-400 px-2 py-1">
                {block.bucketCounts.ShortTerm} / {block.bucketCounts.MediumTerm}
              </td>
            </tr>
            <tr>
              <td className="border border-gray-400 px-2 py-1 font-medium">Pending decisions</td>
              <td className="border border-gray-400 px-2 py-1">{block.pendingDecisions ?? "—"}</td>
              <td className="border border-gray-400 px-2 py-1 font-medium">Model computation date</td>
              <td className="border border-gray-400 px-2 py-1">
                {latestModelVersion ? new Date(latestModelVersion.computedAt).toLocaleDateString("en-IN") : "—"}
              </td>
            </tr>
          </tbody>
        </table>

        <SectionTitle>Capacity shortfall</SectionTitle>
        {block.capacityShortfall === null ? (
          <p className="text-xs text-gray-600">Not available.</p>
        ) : (
          <p className="text-sm">
            Of <strong>{block.capacityShortfall.needsRelocation}</strong> habitations needing relocation (Immediate
            or Short-term priority), <strong>{block.capacityShortfall.hasViableSite}</strong> currently have a
            candidate relocation site with sufficient remaining carrying capacity.{" "}
            <strong>{block.capacityShortfall.noViableSite}</strong> do not — a total of{" "}
            <strong>{block.capacityShortfall.populationWithNoSite.toLocaleString("en-IN")} people</strong> with no
            currently viable relocation site in this district.
          </p>
        )}

        <SectionTitle>Prioritized habitation list</SectionTitle>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="border border-gray-400 px-2 py-1">Habitation</th>
              <th className="border border-gray-400 px-2 py-1">Bucket</th>
              <th className="border border-gray-400 px-2 py-1">Governing hazard</th>
              <th className="border border-gray-400 px-2 py-1 text-right">RPI</th>
              <th className="border border-gray-400 px-2 py-1 text-right">Population</th>
            </tr>
          </thead>
          <tbody>
            {(priorities?.items ?? []).map((p) => (
              <tr key={p.habitationId}>
                <td className="border border-gray-400 px-2 py-1">{p.habitationName}</td>
                <td className="border border-gray-400 px-2 py-1">{BUCKET_LABELS[p.priorityBucket]}</td>
                <td className="border border-gray-400 px-2 py-1">{HAZARD_LABELS[p.governingHazard]}</td>
                <td className="border border-gray-400 px-2 py-1 text-right">{p.relocationPriorityIndex.toFixed(3)}</td>
                <td className="border border-gray-400 px-2 py-1 text-right">
                  {populationByHabitationId.get(p.habitationId)?.toLocaleString("en-IN") ?? "—"}
                </td>
              </tr>
            ))}
            {(priorities?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5} className="border border-gray-400 px-2 py-3 text-center text-gray-500">
                  No Red/Orange priority habitations recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <SectionTitle>Recommended relocation sites</SectionTitle>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="border border-gray-400 px-2 py-1">Habitation</th>
              <th className="border border-gray-400 px-2 py-1">Recommended site</th>
              <th className="border border-gray-400 px-2 py-1 text-right">Suitability</th>
              <th className="border border-gray-400 px-2 py-1 text-right">Effective capacity</th>
              <th className="border border-gray-400 px-2 py-1">Binding constraint</th>
            </tr>
          </thead>
          <tbody>
            {(recommendations?.items ?? []).map((r) => (
              <tr key={r._id}>
                <td className="border border-gray-400 px-2 py-1">{r.habitationId.name}</td>
                <td className="border border-gray-400 px-2 py-1">
                  {r.selectedSiteId ? r.selectedSiteId.name : "No viable site"}
                </td>
                <td className="border border-gray-400 px-2 py-1 text-right">
                  {r.selectedSiteId?.overallSuitabilityScore?.toFixed(3) ?? "—"}
                </td>
                <td className="border border-gray-400 px-2 py-1 text-right">
                  {r.selectedSiteId?.carryingCapacity
                    ? Math.round(r.selectedSiteId.carryingCapacity.effectiveCapacity)
                    : "—"}
                </td>
                <td className="border border-gray-400 px-2 py-1">
                  {r.selectedSiteId?.carryingCapacity?.bindingConstraint ?? "—"}
                </td>
              </tr>
            ))}
            {(recommendations?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5} className="border border-gray-400 px-2 py-3 text-center text-gray-500">
                  No recommendations generated for this district yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <SectionTitle>Decisions taken</SectionTitle>
        {decisions && decisions.items.length > 0 ? (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="border border-gray-400 px-2 py-1">Date</th>
                <th className="border border-gray-400 px-2 py-1">Officer</th>
                <th className="border border-gray-400 px-2 py-1">Action</th>
                <th className="border border-gray-400 px-2 py-1">Justification</th>
              </tr>
            </thead>
            <tbody>
              {decisions.items.map((d) => (
                <tr key={d._id}>
                  <td className="border border-gray-400 px-2 py-1">
                    {new Date(d.decidedAt).toLocaleDateString("en-IN")}
                  </td>
                  <td className="border border-gray-400 px-2 py-1">{d.officerId.name}</td>
                  <td className="border border-gray-400 px-2 py-1">{ACTION_LABELS[d.action] ?? d.action}</td>
                  <td className="border border-gray-400 px-2 py-1">{d.justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-gray-600">No decisions recorded yet for this district.</p>
        )}

        <SectionTitle>Model provenance</SectionTitle>
        <p className="text-xs text-gray-600">
          Hazard/priority assessment: computed{" "}
          {latestModelVersion ? new Date(latestModelVersion.computedAt).toLocaleString("en-IN") : "unknown"}.
          Site-matching model: {recommendationModelVersion ?? "not yet run"}. All figures in this report are
          derived from SYNTHETIC_DEMO data for hackathon evaluation — not real survey or historical records. See
          docs/METHODOLOGY.md for the full computation methodology.
        </p>

        <p className="mt-6 border-t border-gray-400 pt-2 text-[10px] text-gray-500">
          SYNTHETIC_DEMO — PunarVas is a decision-support tool. Every recommendation is advisory and requires review
          and written justification from an authorized officer before it takes effect.
        </p>
      </div>
    </div>
  );
}
