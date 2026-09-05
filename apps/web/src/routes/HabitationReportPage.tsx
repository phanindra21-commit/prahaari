import { useParams } from "react-router-dom";
import { useHabitation, useHabitationExplain, useHazardEvents, useRecommendations } from "../hooks/useApi";

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

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className="mb-2 mt-6 border-b-2 border-black pb-1 text-base font-semibold">{children}</h2>;
}

function count(share: number | undefined, base: number): string {
  if (share === undefined) return "—";
  return Math.round(share * base).toLocaleString("en-IN");
}

/** Step 9 Part 2B: the per-habitation assessment sheet — absolute
 * demographic counts (not just normalized 0-1 shares), the full risk
 * breakdown, disaster history, plain-language top factors, and the
 * recommended site. Same print-optimized approach as
 * DistrictReportPage.tsx. */
export function HabitationReportPage(): JSX.Element {
  const { habitationId } = useParams<{ habitationId: string }>();
  const { data: habitation, isLoading } = useHabitation(habitationId);
  const { data: explain } = useHabitationExplain(habitationId);
  const { data: events } = useHazardEvents(habitation?.districtId);
  const { data: recommendations } = useRecommendations({ districtId: habitation?.districtId });

  const assessment = habitation?.latestAssessment;
  const recommendation = recommendations?.items.find((r) => r.habitationId._id === habitationId);
  const demographics = habitation?.demographics ?? {};

  if (isLoading || !habitation) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-black">
        <p className="text-sm">Loading report…</p>
      </div>
    );
  }

  return (
    <div className="print-report h-full overflow-y-auto bg-white text-black">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-ink-600 bg-ink-900 px-4 py-2">
        <p className="text-xs text-mist-300">Print preview — {habitation.name} assessment sheet</p>
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
        <h1 className="text-xl font-bold">Habitation Assessment Sheet — {habitation.name}</h1>
        <p className="text-xs text-gray-600">
          {habitation.panchayat}, {habitation.block} · Population {habitation.population.toLocaleString("en-IN")} ·
          Households {habitation.households.toLocaleString("en-IN")} · Generated{" "}
          {new Date().toLocaleString("en-IN")}
        </p>

        <div className="mt-3 rounded border border-black bg-gray-50 p-3 text-xs">
          <strong>Advisory only.</strong> This assessment requires review and written justification from a
          competent authority before any relocation decision takes effect.
        </div>

        {!assessment ? (
          <p className="mt-6 text-sm text-gray-600">
            This habitation has not yet been assessed — run the pipeline for its district.
          </p>
        ) : (
          <>
            <SectionTitle>Risk breakdown</SectionTitle>
            <table className="w-full border-collapse text-xs">
              <tbody>
                <tr>
                  <td className="border border-gray-400 px-2 py-1 font-medium">Overall zone class</td>
                  <td className="border border-gray-400 px-2 py-1">{assessment.overallZoneClass}</td>
                  <td className="border border-gray-400 px-2 py-1 font-medium">Governing hazard</td>
                  <td className="border border-gray-400 px-2 py-1">{HAZARD_LABELS[assessment.governingHazard]}</td>
                </tr>
                <tr>
                  <td className="border border-gray-400 px-2 py-1 font-medium">Composite risk score</td>
                  <td className="border border-gray-400 px-2 py-1">{assessment.compositeRiskScore.toFixed(3)}</td>
                  <td className="border border-gray-400 px-2 py-1 font-medium">Coping capacity</td>
                  <td className="border border-gray-400 px-2 py-1">{assessment.copingCapacity.toFixed(3)}</td>
                </tr>
                <tr>
                  <td className="border border-gray-400 px-2 py-1 font-medium">Relocation Priority Index</td>
                  <td className="border border-gray-400 px-2 py-1">
                    {assessment.relocationPriorityIndex?.toFixed(3) ?? "—"}
                  </td>
                  <td className="border border-gray-400 px-2 py-1 font-medium">Priority bucket</td>
                  <td className="border border-gray-400 px-2 py-1">
                    {assessment.priorityBucket ? BUCKET_LABELS[assessment.priorityBucket] : "Not bucketed"}
                  </td>
                </tr>
              </tbody>
            </table>

            <table className="mt-2 w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border border-gray-400 px-2 py-1">Hazard</th>
                  <th className="border border-gray-400 px-2 py-1 text-right">Score</th>
                  <th className="border border-gray-400 px-2 py-1 text-right">Exposure</th>
                  <th className="border border-gray-400 px-2 py-1">Zone</th>
                </tr>
              </thead>
              <tbody>
                {assessment.hazardExposure.map((h) => (
                  <tr key={h.hazardType}>
                    <td className="border border-gray-400 px-2 py-1">{HAZARD_LABELS[h.hazardType]}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{h.hazardScore.toFixed(2)}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{h.exposure.toFixed(2)}</td>
                    <td className="border border-gray-400 px-2 py-1">{h.zoneClass}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {assessment.compoundHazard && (
              <p className="mt-2 text-xs">
                <strong>Compound hazard:</strong> {HAZARD_LABELS[assessment.compoundHazard.trigger]} triggers{" "}
                {HAZARD_LABELS[assessment.compoundHazard.mechanism]} at this site — both independently Red/Orange.
                Compound risk {assessment.compoundHazard.compoundRisk.toFixed(3)}.
              </p>
            )}

            <SectionTitle>Vulnerability — dimension scores and absolute counts</SectionTitle>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border border-gray-400 px-2 py-1">Dimension</th>
                  <th className="border border-gray-400 px-2 py-1 text-right">Normalized score</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(assessment.vulnerabilityDimensions).map(([dim, score]) => (
                  <tr key={dim}>
                    <td className="border border-gray-400 px-2 py-1 capitalize">{dim}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{score.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="mt-2 w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border border-gray-400 px-2 py-1">Indicator</th>
                  <th className="border border-gray-400 px-2 py-1 text-right">Estimated count</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-gray-400 px-2 py-1">Children under 5</td>
                  <td className="border border-gray-400 px-2 py-1 text-right">
                    {count(demographics.shareUnder5, habitation.population)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-400 px-2 py-1">Residents over 60</td>
                  <td className="border border-gray-400 px-2 py-1 text-right">
                    {count(demographics.shareOver60, habitation.population)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-400 px-2 py-1">Women-headed households</td>
                  <td className="border border-gray-400 px-2 py-1 text-right">
                    {count(demographics.womenHeadedHouseholdShare, habitation.households)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-400 px-2 py-1">Persons with disability</td>
                  <td className="border border-gray-400 px-2 py-1 text-right">
                    {count(demographics.disabledPersonsShare, habitation.population)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-gray-500">
              Estimated by applying the recorded demographic share to total population/households — not an
              independent headcount.
            </p>

            {explain && explain.explanation.length > 0 && (
              <>
                <SectionTitle>Why this ranking — top factors</SectionTitle>
                <ul className="list-inside list-disc text-xs">
                  {explain.explanation.map((entry, i) => (
                    <li key={i}>
                      {entry.label ?? entry.factor} (
                      {entry.direction === "INCREASES_RISK" ? "increases" : "decreases"} risk by{" "}
                      {Math.abs(entry.contribution).toFixed(3)})
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        <SectionTitle>Disaster history</SectionTitle>
        {events && events.items.length > 0 ? (
          <ul className="list-inside list-disc text-xs">
            {events.items.map((event) => (
              <li key={event._id}>
                {event.name} — {new Date(event.date).toLocaleDateString("en-IN")}, {HAZARD_LABELS[event.hazardType]},{" "}
                {event.deaths} deaths, {event.displaced.toLocaleString("en-IN")} displaced ({event.dataProvenance})
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-600">No recorded events for this district.</p>
        )}

        <SectionTitle>Recommended relocation site</SectionTitle>
        {recommendation?.selectedSiteId ? (
          <table className="w-full border-collapse text-xs">
            <tbody>
              <tr>
                <td className="border border-gray-400 px-2 py-1 font-medium">Site</td>
                <td className="border border-gray-400 px-2 py-1">{recommendation.selectedSiteId.name}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1 font-medium">Suitability score</td>
                <td className="border border-gray-400 px-2 py-1">
                  {recommendation.selectedSiteId.overallSuitabilityScore?.toFixed(3) ?? "—"}
                </td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1 font-medium">Effective carrying capacity</td>
                <td className="border border-gray-400 px-2 py-1">
                  {recommendation.selectedSiteId.carryingCapacity
                    ? `${Math.round(recommendation.selectedSiteId.carryingCapacity.effectiveCapacity)} households`
                    : "—"}
                </td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1 font-medium">Binding constraint</td>
                <td className="border border-gray-400 px-2 py-1">
                  {recommendation.selectedSiteId.carryingCapacity?.bindingConstraint ?? "—"}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-gray-600">
            {recommendation
              ? "No candidate site currently has sufficient remaining carrying capacity for this habitation."
              : "No recommendation generated for this habitation yet."}
          </p>
        )}

        <p className="mt-6 border-t border-gray-400 pt-2 text-[10px] text-gray-500">
          SYNTHETIC_DEMO — PunarVas is a decision-support tool. Every recommendation is advisory and requires review
          and written justification from an authorized officer before it takes effect.
        </p>
      </div>
    </div>
  );
}
