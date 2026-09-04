import { useParams, Link } from "react-router-dom";
import { useHabitation, useHabitationExplain, useRecommendation } from "../hooks/useApi";
import { ZoneBadge } from "../components/ui/ZoneBadge";
import { PriorityBadge } from "../components/ui/PriorityBadge";
import { RecommendationStatusBadge } from "../components/ui/RecommendationStatusBadge";
import { ProvenanceFooter } from "../components/ui/ProvenanceFooter";
import { RecommendationMap } from "../components/decisions/RecommendationMap";
import { DecisionActionPanel } from "../components/decisions/DecisionActionPanel";
import { AuditTrailPanel } from "../components/decisions/AuditTrailPanel";
import type { CarryingCapacity, RelocationSiteDetail } from "../lib/api";

const HAZARD_LABELS: Record<string, string> = {
  landslide: "Landslide",
  flood: "Flood",
  coastalErosion: "Coastal erosion",
  cloudburst: "Cloudburst",
};

const CRITERION_LABELS: Record<string, string> = {
  hazardSafety: "Hazard safety",
  waterAvailability: "Water availability",
  landAvailability: "Land availability",
  roadConnectivity: "Road connectivity",
  distanceFromOriginHabitation: "Distance from origin habitation",
  livelihoodAccess: "Livelihood access",
  landOwnershipAcquisitionEase: "Land ownership / acquisition ease",
  existingInfrastructure: "Existing infrastructure",
  slope: "Slope",
};

const CRITERION_ORDER = Object.keys(CRITERION_LABELS);

const CONSTRAINT_LABELS: Record<keyof Omit<CarryingCapacity, "effectiveCapacity" | "bindingConstraint">, string> = {
  byLand: "Land",
  byWater: "Water",
  byEducation: "Education",
  byHealth: "Health",
  byAccess: "Access",
};

const CONSTRAINT_KEY_FOR: Record<CarryingCapacity["bindingConstraint"], keyof typeof CONSTRAINT_LABELS> = {
  LAND: "byLand",
  WATER: "byWater",
  EDUCATION: "byEducation",
  HEALTH: "byHealth",
  ACCESS: "byAccess",
};

function SuitabilityBar({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="mb-1.5">
      <div className="mb-0.5 flex items-center justify-between text-xs text-mist-300">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(3)}</span>
      </div>
      <div className="h-1.5 rounded-sm bg-ink-700">
        <div className="h-full rounded-sm bg-signal" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
      </div>
    </div>
  );
}

function CapacityRow({ label, value, binding }: { label: string; value: number; binding: boolean }): JSX.Element {
  return (
    <div
      className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
        binding ? "border border-zone-orange/50 bg-zone-orange/10 text-zone-orange" : "text-mist-300"
      }`}
    >
      <span className={binding ? "font-semibold" : ""}>
        {label}
        {binding ? " ← binding constraint" : ""}
      </span>
      <span className="font-mono">{Math.round(value).toLocaleString("en-IN")} households</span>
    </div>
  );
}

function SiteSuitabilityPanel({ site }: { site: RelocationSiteDetail }): JSX.Element {
  return (
    <div className="rounded border border-ink-600 bg-ink-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-mist-100">{site.name}</p>
        <span className="font-mono text-xs text-mist-300">
          {site.overallSuitabilityScore !== null ? site.overallSuitabilityScore.toFixed(3) : "—"} overall
        </span>
      </div>

      {CRITERION_ORDER.some((k) => k in site.suitabilitySubScores) && (
        <div className="mb-3">
          {CRITERION_ORDER.filter((k) => k in site.suitabilitySubScores).map((k) => (
            <SuitabilityBar key={k} label={CRITERION_LABELS[k]!} value={site.suitabilitySubScores[k]!} />
          ))}
        </div>
      )}

      {site.carryingCapacity ? (
        <div className="space-y-1 border-t border-ink-700 pt-2">
          <p className="mb-1 text-[11px] font-medium text-mist-400">
            Carrying capacity — effective {Math.round(site.carryingCapacity.effectiveCapacity)} households
          </p>
          {(Object.keys(CONSTRAINT_LABELS) as Array<keyof typeof CONSTRAINT_LABELS>).map((key) => (
            <CapacityRow
              key={key}
              label={CONSTRAINT_LABELS[key]}
              value={site.carryingCapacity![key]}
              binding={CONSTRAINT_KEY_FOR[site.carryingCapacity!.bindingConstraint] === key}
            />
          ))}
        </div>
      ) : (
        <p className="border-t border-ink-700 pt-2 text-[11px] text-mist-400">
          Not scored — this site failed an exclusion criterion.
        </p>
      )}
    </div>
  );
}

export function RecommendationDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data: rec, isLoading } = useRecommendation(id);
  const { data: habitation } = useHabitation(rec?.habitationId._id);
  const { data: explain } = useHabitationExplain(rec?.habitationId._id);
  const assessment = habitation?.latestAssessment;

  if (isLoading || !rec) {
    return <p className="p-4 text-sm text-mist-300">Loading recommendation…</p>;
  }

  const selectedSite = rec.selectedSiteId ?? rec.candidateSites[0]?.relocationSiteId ?? null;

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <Link to="/recommendations" className="mb-3 inline-block text-xs text-signal-bright hover:underline">
        ← Back to review queue
      </Link>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-sm font-semibold text-mist-50">{rec.habitationId.name}</h1>
        <PriorityBadge bucket={rec.priorityBucket} />
        <RecommendationStatusBadge status={rec.status} />
        {assessment && <ZoneBadge zoneClass={assessment.overallZoneClass} />}
        {rec.phasing.length === 0 && (
          <span className="rounded border border-zone-red/40 bg-zone-red/10 px-1.5 py-0.5 text-[11px] text-zone-red">
            No site with sufficient capacity
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: risk story + map */}
        <div className="space-y-4">
          <section className="rounded border border-ink-600 bg-ink-800 p-3">
            <p className="mb-2 text-xs font-medium text-mist-200">Habitation &amp; risk story</p>
            <div className="mb-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-[11px] text-mist-400">Population</p>
                <p className="font-mono text-mist-50">{rec.habitationId.population.toLocaleString("en-IN")}</p>
              </div>
              <div>
                <p className="text-[11px] text-mist-400">Households</p>
                <p className="font-mono text-mist-50">{rec.habitationId.households.toLocaleString("en-IN")}</p>
              </div>
              <div>
                <p className="text-[11px] text-mist-400">Location</p>
                <p className="text-mist-200">
                  {rec.habitationId.panchayat}, {rec.habitationId.block}
                </p>
              </div>
            </div>
            {assessment && (
              <>
                <div className="mb-1.5 flex items-center gap-2 text-xs text-mist-300">
                  <span>Governing hazard: {HAZARD_LABELS[assessment.governingHazard] ?? assessment.governingHazard}</span>
                  <span className="font-mono">RPI {assessment.relocationPriorityIndex?.toFixed(3) ?? "—"}</span>
                </div>
                <div className="mb-1.5 grid grid-cols-2 gap-2 text-xs text-mist-300">
                  <span>Composite risk: {assessment.compositeRiskScore.toFixed(3)}</span>
                  <span>Vulnerability index: {assessment.vulnerabilityIndex.toFixed(3)}</span>
                </div>
                {explain && explain.explanation.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-mist-300">
                    {explain.explanation.slice(0, 3).map((entry, i) => (
                      <li key={i} className="rounded border border-ink-700 bg-ink-900 px-2 py-1">
                        {entry.label ?? entry.factor}
                        <span className="ml-1 font-mono text-mist-500">
                          ({entry.direction === "INCREASES_RISK" ? "+" : "−"}
                          {Math.abs(entry.contribution).toFixed(3)})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="h-80 overflow-hidden rounded border border-ink-600">
            <RecommendationMap
              origin={rec.habitationId.centroid}
              originName={rec.habitationId.name}
              candidateSites={rec.candidateSites}
              selectedSiteId={selectedSite?._id ?? null}
            />
          </section>

          <section className="rounded border border-ink-600 bg-ink-800 p-3">
            <p className="mb-1.5 text-xs font-medium text-mist-200">Rationale</p>
            <p className="text-xs leading-relaxed text-mist-300">{rec.rationale}</p>
          </section>
        </div>

        {/* Right: candidate sites + decision */}
        <div className="space-y-4">
          <section>
            <p className="mb-2 text-xs font-medium text-mist-200">
              Ranked candidate sites ({rec.candidateSites.length})
            </p>
            <div className="space-y-2">
              {rec.candidateSites.map((c) => (
                <div key={c.relocationSiteId._id} className="relative">
                  {c.relocationSiteId._id === selectedSite?._id && (
                    <span className="absolute -left-2 -top-2 z-10 rounded border border-signal-bright/60 bg-signal/20 px-1.5 py-0.5 text-[10px] font-medium text-signal-bright">
                      #{c.rank} · selected
                    </span>
                  )}
                  <SiteSuitabilityPanel site={c.relocationSiteId} />
                </div>
              ))}
              {rec.candidateSites.length === 0 && (
                <p className="text-xs text-mist-400">No non-excluded candidate sites were available.</p>
              )}
            </div>
          </section>

          <section>
            <DecisionActionPanel recommendation={rec} />
          </section>

          <section>
            <AuditTrailPanel recommendationId={rec._id} />
          </section>
        </div>
      </div>

      <div className="mt-4">
        <ProvenanceFooter modelVersion={rec.modelVersion} computedAt={rec.generatedAt} />
      </div>
    </div>
  );
}
