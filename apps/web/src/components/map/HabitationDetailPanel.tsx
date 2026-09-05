import { Link } from "react-router-dom";
import { useHabitation, useHabitationExplain, useHazardEvents, useRecommendations } from "../../hooks/useApi";
import { ZoneBadge } from "../ui/ZoneBadge";
import { PriorityBadge } from "../ui/PriorityBadge";
import { RecommendationStatusBadge } from "../ui/RecommendationStatusBadge";
import { ProvenanceFooter } from "../ui/ProvenanceFooter";

const HAZARD_LABELS: Record<string, string> = {
  landslide: "Landslide",
  flood: "Flood",
  coastalErosion: "Coastal erosion",
  cloudburst: "Cloudburst",
};

const DIMENSION_LABELS: Record<string, string> = {
  demographic: "Demographic",
  socioeconomic: "Socioeconomic",
  structural: "Structural",
  accessibility: "Accessibility",
};

function Bar({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="mb-1.5">
      <div className="mb-0.5 flex items-center justify-between text-xs text-mist-300">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(3)}</span>
      </div>
      <div className="h-1.5 rounded-sm bg-ink-700">
        <div
          className="h-full rounded-sm bg-signal"
          style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <p className="text-[11px] text-mist-400">{label}</p>
      <p className="font-mono text-sm text-mist-50">{value}</p>
    </div>
  );
}

interface CohortRow {
  label: string;
  count: number;
  share: number;
  color: string;
}

/**
 * Step 10 Part 1A/1B: absolute demographic counts alongside the normalized
 * shares the vulnerability score already uses (vulnerability-weights.json's
 * demographic indicators: shareUnder5 0.30, shareOver60 0.25,
 * womenHeadedHouseholdShare 0.20, disabledPersonsShare 0.25). Working-age
 * adults is the remainder once under-5/school-age/over-60 are accounted
 * for — see shareSchoolAge6to14's derivation note in Habitation.ts.
 *
 * The visual is a stacked composition bar, not a true age pyramid: a
 * pyramid needs a male/female split per age band, which this dataset does
 * not carry (and inventing gender-disaggregated counts would be exactly
 * the kind of unsupported synthetic data this project avoids fabricating
 * — see CLAUDE.md's SYNTHETIC_DEMO conventions). A stacked bar shows the
 * same four-cohort composition at a glance without that fabrication.
 */
function AgeCompositionSection({
  population,
  households,
  demographics,
}: {
  population: number;
  households: number;
  demographics: Record<string, number>;
}): JSX.Element {
  const shareUnder5 = demographics.shareUnder5 ?? 0;
  const shareSchoolAge = demographics.shareSchoolAge6to14 ?? 0;
  const shareOver60 = demographics.shareOver60 ?? 0;
  const shareWorkingAge = Math.max(0, 1 - shareUnder5 - shareSchoolAge - shareOver60);
  const shareWomenHeaded = demographics.womenHeadedHouseholdShare ?? 0;
  const shareDisabled = demographics.disabledPersonsShare ?? 0;

  const ageBands: CohortRow[] = [
    { label: "Under 5", count: Math.round(population * shareUnder5), share: shareUnder5, color: "bg-signal" },
    {
      label: "School-age (6–14)",
      count: Math.round(population * shareSchoolAge),
      share: shareSchoolAge,
      color: "bg-sky-500",
    },
    {
      label: "Working-age (15–59)",
      count: Math.round(population * shareWorkingAge),
      share: shareWorkingAge,
      color: "bg-mist-300",
    },
    { label: "Over 60", count: Math.round(population * shareOver60), share: shareOver60, color: "bg-amber-500" },
  ];

  return (
    <section className="mb-4">
      <p className="mb-2 text-xs font-medium text-mist-200">Population composition</p>

      <div className="mb-2 flex h-3 w-full overflow-hidden rounded-sm">
        {ageBands.map((band) => (
          <div
            key={band.label}
            className={band.color}
            style={{ width: `${Math.max(0, band.share * 100)}%` }}
            title={`${band.label}: ${(band.share * 100).toFixed(0)}%`}
          />
        ))}
      </div>

      <div className="mb-2 space-y-1">
        {ageBands.map((band) => (
          <div key={band.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-mist-300">
              <span className={`inline-block h-2 w-2 rounded-sm ${band.color}`} />
              {band.label}
            </span>
            <span className="font-mono text-mist-100">
              {band.count.toLocaleString("en-IN")} <span className="text-mist-400">({(band.share * 100).toFixed(0)}%)</span>
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-1 border-t border-ink-700 pt-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-mist-300">Women-headed households</span>
          <span className="font-mono text-mist-100">
            {Math.round(households * shareWomenHeaded).toLocaleString("en-IN")}{" "}
            <span className="text-mist-400">({(shareWomenHeaded * 100).toFixed(0)}% of households)</span>
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-mist-300">Persons with disability</span>
          <span className="font-mono text-mist-100">
            {Math.round(population * shareDisabled).toLocaleString("en-IN")}{" "}
            <span className="text-mist-400">({(shareDisabled * 100).toFixed(0)}% of population)</span>
          </span>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-mist-500">
        Estimated by applying the recorded demographic share to total population/households — not an independent
        headcount.
      </p>
    </section>
  );
}

interface HabitationDetailPanelProps {
  habitationId: string;
  onClose: () => void;
}

export function HabitationDetailPanel({ habitationId, onClose }: HabitationDetailPanelProps): JSX.Element {
  const { data: habitation, isLoading, isError } = useHabitation(habitationId);
  const { data: explain } = useHabitationExplain(habitationId);
  const { data: events } = useHazardEvents(habitation?.districtId);
  const { data: recommendations } = useRecommendations({ districtId: habitation?.districtId });

  const assessment = habitation?.latestAssessment;
  const recommendation = recommendations?.items.find((r) => r.habitationId._id === habitationId);

  return (
    <div className="flex h-full w-96 flex-col border-l border-ink-600 bg-ink-900 shadow-panel">
      <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
        <h2 className="text-sm font-semibold text-mist-50">
          {habitation?.name ?? (isError ? "Not found" : "Loading…")}
        </h2>
        <div className="flex items-center gap-1">
          {habitation && (
            <Link
              to={`/reports/habitation/${habitationId}`}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-ink-500 px-2 py-1 text-[11px] text-mist-300 hover:border-signal-bright/60 hover:text-signal-bright"
            >
              Download report
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 text-mist-400 hover:bg-ink-700 hover:text-mist-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-3">
        {isLoading && <p className="text-sm text-mist-300">Loading habitation…</p>}

        {isError && <p className="text-sm text-zone-red">Could not load this habitation.</p>}

        {habitation && (
          <>
            <p className="mb-3 text-xs text-mist-300">
              {habitation.panchayat}, {habitation.block}
            </p>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <Stat label="Population" value={habitation.population.toLocaleString("en-IN")} />
              <Stat label="Households" value={habitation.households.toLocaleString("en-IN")} />
            </div>

            <AgeCompositionSection
              population={habitation.population}
              households={habitation.households}
              demographics={habitation.demographics}
            />

            {assessment ? (
              <>
                <div className="mb-4 flex items-center gap-2">
                  <ZoneBadge zoneClass={assessment.overallZoneClass} />
                  <PriorityBadge bucket={assessment.priorityBucket} />
                  {assessment.relocationPriorityIndex !== null && (
                    <span className="font-mono text-xs text-mist-300">
                      RPI {assessment.relocationPriorityIndex.toFixed(3)}
                    </span>
                  )}
                </div>

                {recommendation && (
                  <Link
                    to={`/recommendations/${recommendation._id}`}
                    className="mb-4 flex items-center justify-between rounded border border-signal-bright/50 bg-signal/10 px-3 py-2 text-xs text-signal-bright hover:bg-signal/20"
                  >
                    <span>View recommendation</span>
                    <RecommendationStatusBadge status={recommendation.status} />
                  </Link>
                )}

                {assessment.compoundHazard && (
                  <section className="mb-4 rounded border border-signal-bright/50 bg-signal/10 p-3">
                    <p className="mb-1 text-xs font-medium text-signal-bright">Compound hazard</p>
                    <p className="text-xs leading-relaxed text-mist-200">
                      Both {HAZARD_LABELS[assessment.compoundHazard.trigger]} (the trigger — a risk score of{" "}
                      {assessment.compoundHazard.triggerRisk.toFixed(3)}) and{" "}
                      {HAZARD_LABELS[assessment.compoundHazard.mechanism]} (the mechanism that damages
                      habitations — {assessment.compoundHazard.mechanismRisk.toFixed(3)}) are independently
                      Red/Orange at this site. Reported as one compound risk (
                      {assessment.compoundHazard.compoundRisk.toFixed(3)}), not two competing hazards.
                    </p>
                  </section>
                )}

                <section className="mb-4 rounded border border-ink-600 bg-ink-800 p-3">
                  <p className="mb-2 text-xs font-medium text-mist-200">
                    Risk breakdown — governing hazard: {HAZARD_LABELS[assessment.governingHazard]}
                    {assessment.compoundHazard ? " (mechanism)" : ""}
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <Stat label="Composite risk" value={assessment.compositeRiskScore.toFixed(3)} />
                    <Stat label="Coping capacity" value={assessment.copingCapacity.toFixed(3)} />
                  </div>
                  <div className="mt-2 space-y-1">
                    {assessment.hazardExposure.map((h) => (
                      <div key={h.hazardType} className="flex items-center justify-between text-xs">
                        <span className="text-mist-300">
                          {HAZARD_LABELS[h.hazardType]}
                          {h.hazardType === assessment.governingHazard ? " ·" : ""}
                        </span>
                        <span className="font-mono text-mist-100">
                          score {h.hazardScore.toFixed(2)} · exposure {h.exposure.toFixed(2)}
                          {h.disasterHistoryBoost > 0 ? ` (+${h.disasterHistoryBoost.toFixed(2)} history)` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mb-4">
                  <p className="mb-2 text-xs font-medium text-mist-200">
                    Vulnerability Index — {assessment.vulnerabilityIndex.toFixed(3)}
                  </p>
                  {Object.entries(assessment.vulnerabilityDimensions).map(([key, value]) => (
                    <Bar key={key} label={DIMENSION_LABELS[key] ?? key} value={value} />
                  ))}
                </section>

                {explain && explain.explanation.length > 0 && (
                  <section className="mb-4">
                    <p className="mb-2 text-xs font-medium text-mist-200">Why this ranking</p>
                    <ul className="space-y-1.5 text-xs text-mist-300">
                      {explain.explanation.map((entry, i) => (
                        <li key={i} className="rounded border border-ink-600 bg-ink-800 px-2 py-1.5">
                          {entry.label ?? entry.factor}
                          <span className="ml-1 font-mono text-mist-400">
                            ({entry.direction === "INCREASES_RISK" ? "+" : "−"}
                            {Math.abs(entry.contribution).toFixed(3)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            ) : (
              <p className="mb-4 rounded border border-ink-600 bg-ink-800 px-3 py-2 text-xs text-mist-300">
                Not yet assessed — run the pipeline for this district to compute a priority ranking.
              </p>
            )}

            <section className="mb-2">
              <p className="mb-2 text-xs font-medium text-mist-200">Disaster history</p>
              {events && events.items.length > 0 ? (
                <ul className="space-y-2">
                  {events.items.map((event) => (
                    <li key={event._id} className="rounded border border-ink-600 bg-ink-800 p-2 text-xs">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-mist-100">{event.name}</span>
                        <span
                          className={`rounded border px-1 py-0.5 font-mono text-[10px] ${
                            event.dataProvenance === "PUBLIC_RECORD"
                              ? "border-signal/40 text-signal-bright"
                              : "border-mist-400/40 text-mist-300"
                          }`}
                        >
                          {event.dataProvenance}
                        </span>
                      </div>
                      <p className="text-mist-400">
                        {new Date(event.date).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
                        {" · "}
                        {HAZARD_LABELS[event.hazardType] ?? event.hazardType}
                        {" · "}
                        {event.deaths} deaths, {event.displaced.toLocaleString("en-IN")} displaced
                      </p>
                      {event.sourceUrl && (
                        <a
                          href={event.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-signal-bright hover:underline"
                        >
                          {event.source} source
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-mist-400">No recorded events for this district.</p>
              )}
            </section>
          </>
        )}
      </div>

      <ProvenanceFooter
        modelVersion={assessment?.modelVersion}
        computedAt={assessment?.computedAt}
        dataProvenance={habitation?.dataProvenance}
      />
    </div>
  );
}
