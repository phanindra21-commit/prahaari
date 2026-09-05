import { useParams, Link } from "react-router-dom";
import { useHabitation, useHabitationExplain, useRecommendation } from "../hooks/useApi";
import { ZoneBadge } from "../components/ui/ZoneBadge";
import { PriorityBadge } from "../components/ui/PriorityBadge";
import { RecommendationStatusBadge } from "../components/ui/RecommendationStatusBadge";
import { ProvenanceFooter } from "../components/ui/ProvenanceFooter";
import { RecommendationMap } from "../components/decisions/RecommendationMap";
import { DecisionActionPanel } from "../components/decisions/DecisionActionPanel";
import { AuditTrailPanel } from "../components/decisions/AuditTrailPanel";
import { ApiError } from "../lib/apiClient";
import type { CarryingCapacity, RelocationSiteDetail, RouteExposureEntry, RouteInfo } from "../lib/api";

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

/** Step 10 Part 3D: "Direct route crosses 2.1 km of Red zone; safest route
 * adds 3.4 km and stays clear" — the most visually memorable claim of the
 * demo, so it needs a plain-language caption alongside the map, not just
 * the two colored lines. */
function describeExposure(exposure: RouteExposureEntry[]): string {
  const concerning = exposure.filter((e) => e.zoneClass === "Red" || e.zoneClass === "Orange");
  if (concerning.length === 0) return "stays clear of Red/Orange zones";
  return `crosses ${concerning.map((e) => `${e.km.toFixed(1)} km of ${e.zoneClass} zone`).join(" and ")}`;
}

function concerningKm(exposure: RouteExposureEntry[]): number {
  return exposure.filter((e) => e.zoneClass === "Red" || e.zoneClass === "Orange").reduce((sum, e) => sum + e.km, 0);
}

/**
 * Follow-up diagnosis (post-Step-10): a low percentage reduction here does
 * NOT mean routing.py is under-penalizing Red — verified against live
 * Wayanad data that Mundakkai/Chooralmala/Pozhuthana sit in terrain that is
 * 75-100% Red/Orange within 1 km of their own centroid, so any route out
 * necessarily crosses some of it. Steepening the Red multiplier 1600x (60
 * to 100,000 in routing-costs.json) in a live re-check cut the residual
 * Red exposure by only 0.05 km — confirming this is a geographic fact
 * about the origin, not a cost-curve bug. The real reduction that IS
 * achievable ranges 24-34% for these hazard-encircled habitations, versus
 * 67% for Achooranam (whose surroundings leave more room to route around)
 * — 35% is the data-derived cut between "a materially safer corridor was
 * found" and "no fully clear corridor exists, be honest about it" below.
 */
const CLEAR_CORRIDOR_REDUCTION_THRESHOLD_PCT = 35;

function RouteSafetyCaption({ route, originName }: { route: RouteInfo; originName: string }): JSX.Element {
  const extraKm = route.routeLengthKm - route.directLengthKm;
  const directConcerning = concerningKm(route.directExposure);
  const routeConcerning = concerningKm(route.routeExposure);
  const reduction = directConcerning - routeConcerning;
  const reductionPct = directConcerning > 0 ? (reduction / directConcerning) * 100 : 0;
  const clearCorridorFound = directConcerning === 0 || reductionPct >= CLEAR_CORRIDOR_REDUCTION_THRESHOLD_PCT;

  const safestPhrase =
    extraKm > 0.05
      ? `safest route adds ${extraKm.toFixed(1)} km and ${describeExposure(route.routeExposure)}`
      : `safest route ${describeExposure(route.routeExposure)}`;

  return (
    <div className="mt-2 rounded border border-ink-600 bg-ink-900 p-2.5 text-xs leading-relaxed text-mist-200">
      <div className="mb-1.5 flex items-center gap-4 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-zone-green" /> Safest route ({route.routeLengthKm.toFixed(1)} km)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-zone-red" /> Direct line (
          {route.directLengthKm.toFixed(1)} km)
        </span>
      </div>
      {clearCorridorFound ? (
        <p>
          Direct route {describeExposure(route.directExposure)}; {safestPhrase}
          {directConcerning > 0 && routeConcerning >= 0
            ? ` — a ${reductionPct.toFixed(0)}% cut in Red/Orange exposure versus the direct line`
            : ""}
          .
        </p>
      ) : (
        <p>
          No fully clear corridor exists from {originName} to this site: the origin sits within terrain that is
          mostly Red/Orange zone for several kilometres in every direction, so any route out crosses some of it.
          Direct route {describeExposure(route.directExposure)}; the safest available route still reduces
          Red/Orange exposure by only {Math.max(reduction, 0).toFixed(1)} km ({Math.max(reductionPct, 0).toFixed(0)}
          %) — {safestPhrase}.
        </p>
      )}
      <p className="mt-1 text-[10px] text-mist-500">
        Corridor-level routing over the hazard grid, not road-network routing — an advisory approximation, not a
        navigable path.
      </p>
    </div>
  );
}

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

/**
 * Step 10 Part 1D: names the demographic cohort driving an EDUCATION or
 * HEALTH binding constraint, e.g. "education-bound: ~34 school-age
 * children exceed nearby RTE headroom by ~9." Both `byEducation`/`byHealth`
 * (services/ml/app/engine/capacity.py) and the moving population are
 * expressed in households; this is a display-only conversion to persons
 * via the origin habitation's own average household size
 * (population / households) and its recorded demographic shares — it does
 * not change the underlying capacity computation or its households-based
 * binding-constraint decision, only how the shortfall is *described* to
 * the officer. HEALTH's cohort is over-60 + disabled residents (the two
 * demographic groups IPHS/IHPS health-facility norms are meant to serve),
 * not a share the capacity model itself tracks separately.
 */
function CohortNote({
  bindingConstraint,
  byEducation,
  byHealth,
  estimatedHouseholdsToMove,
  originPopulation,
  originHouseholds,
  demographics,
}: {
  bindingConstraint: CarryingCapacity["bindingConstraint"];
  byEducation: number;
  byHealth: number;
  estimatedHouseholdsToMove: number;
  originPopulation: number;
  originHouseholds: number;
  demographics: Record<string, number> | undefined;
}): JSX.Element | null {
  if (bindingConstraint !== "EDUCATION" && bindingConstraint !== "HEALTH") return null;
  if (!demographics || originHouseholds === 0) return null;

  const avgHouseholdSize = originPopulation / originHouseholds;
  const movingPopulation = estimatedHouseholdsToMove * avgHouseholdSize;

  const cohortShare =
    bindingConstraint === "EDUCATION"
      ? (demographics.shareSchoolAge6to14 ?? 0)
      : (demographics.shareOver60 ?? 0) + (demographics.disabledPersonsShare ?? 0);
  const cohortLabel = bindingConstraint === "EDUCATION" ? "school-age children" : "elderly and disabled residents";
  const headroomLabel = bindingConstraint === "EDUCATION" ? "RTE" : "PHC";
  const effectiveCapacity = bindingConstraint === "EDUCATION" ? byEducation : byHealth;

  const cohortMoving = Math.round(movingPopulation * cohortShare);
  const cohortHeadroom = Math.round(effectiveCapacity * avgHouseholdSize * cohortShare);
  const shortfall = cohortMoving - cohortHeadroom;

  if (cohortMoving <= 0) return null;

  return (
    <p className="mt-1.5 rounded border border-zone-orange/40 bg-zone-orange/10 px-2 py-1.5 text-[11px] leading-relaxed text-zone-orange">
      {bindingConstraint === "EDUCATION" ? "Education-bound" : "Health-bound"}: approximately {cohortMoving}{" "}
      {cohortLabel} in this move
      {shortfall > 0
        ? ` exceed nearby ${headroomLabel} headroom by approximately ${shortfall}.`
        : ` are within nearby ${headroomLabel} headroom (approximately ${cohortHeadroom}).`}
    </p>
  );
}

function SiteSuitabilityPanel({
  site,
  estimatedHouseholdsToMove,
  originPopulation,
  originHouseholds,
  demographics,
}: {
  site: RelocationSiteDetail;
  estimatedHouseholdsToMove: number;
  originPopulation: number;
  originHouseholds: number;
  demographics: Record<string, number> | undefined;
}): JSX.Element {
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
          <CohortNote
            bindingConstraint={site.carryingCapacity.bindingConstraint}
            byEducation={site.carryingCapacity.byEducation}
            byHealth={site.carryingCapacity.byHealth}
            estimatedHouseholdsToMove={estimatedHouseholdsToMove}
            originPopulation={originPopulation}
            originHouseholds={originHouseholds}
            demographics={demographics}
          />
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
  const { data: rec, isLoading, isError, error } = useRecommendation(id);
  const { data: habitation } = useHabitation(rec?.habitationId._id);
  const { data: explain } = useHabitationExplain(rec?.habitationId._id);
  const assessment = habitation?.latestAssessment;

  if (isLoading) {
    return <p className="p-4 text-sm text-mist-300">Loading recommendation…</p>;
  }

  if (isError || !rec) {
    return (
      <div className="p-4">
        <Link to="/recommendations" className="mb-3 inline-block text-xs text-signal-bright hover:underline">
          ← Back to review queue
        </Link>
        <p className="text-sm text-zone-red">
          Could not load this recommendation
          {error instanceof ApiError ? `: ${error.message}` : " — it may not exist, or may be out of your scope."}
        </p>
      </div>
    );
  }

  const selectedSite = rec.selectedSiteId ?? rec.candidateSites[0]?.relocationSiteId ?? null;
  const selectedCandidate = rec.candidateSites.find((c) => c.relocationSiteId._id === selectedSite?._id);

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

          <section>
            <div className="h-80 overflow-hidden rounded border border-ink-600">
              <RecommendationMap
                origin={rec.habitationId.centroid}
                originName={rec.habitationId.name}
                candidateSites={rec.candidateSites}
                selectedSiteId={selectedSite?._id ?? null}
              />
            </div>
            {selectedCandidate?.route && (
              <RouteSafetyCaption route={selectedCandidate.route} originName={rec.habitationId.name} />
            )}
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
                  <SiteSuitabilityPanel
                    site={c.relocationSiteId}
                    estimatedHouseholdsToMove={rec.estimatedHouseholdsToMove}
                    originPopulation={rec.habitationId.population}
                    originHouseholds={rec.habitationId.households}
                    demographics={habitation?.demographics}
                  />
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
