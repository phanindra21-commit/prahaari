import { useState } from "react";
import { usePriorities, useRecommendations } from "../../hooks/useApi";

interface DistrictCapacityBannerProps {
  districtId: string;
  districtName: string;
}

/**
 * Step 7 Commit 3G: the site-capacity shortfall is a headline finding for a
 * District Collector, not a footnote buried in a per-habitation rationale
 * string. "Needs relocation" is every Immediate/ShortTerm habitation
 * (usePriorities, matching MATCHABLE_BUCKETS in siteStage.ts); "has a
 * viable site" is every one of those with a non-empty Recommendation.phasing
 * (siteStage.ts only writes a phase-1 entry when a site had enough
 * remaining carrying capacity to take it). Both numbers come from data
 * already persisted and already scoped — no new backend endpoint needed.
 */
export function DistrictCapacityBanner({ districtId, districtName }: DistrictCapacityBannerProps): JSX.Element | null {
  const { data: priorities } = usePriorities(districtId);
  const { data: recommendations } = useRecommendations({ districtId });
  const [expanded, setExpanded] = useState(false);

  if (!priorities || !recommendations) return null;

  const needsRelocation = priorities.items.filter(
    (p) => p.priorityBucket === "Immediate" || p.priorityBucket === "ShortTerm",
  ).length;
  const matched = recommendations.items.filter((r) => r.phasing.length > 0).length;
  const unmatchedRecs = recommendations.items.filter((r) => r.phasing.length === 0);
  const noSite = Math.max(0, needsRelocation - matched);

  if (needsRelocation === 0) return null;

  if (noSite === 0) {
    return (
      <div className="mb-4 rounded border border-zone-green/40 bg-zone-green/10 px-3 py-2 text-xs text-zone-green">
        <span className="font-medium">{districtName}</span> has a viable candidate site for every one of its{" "}
        {needsRelocation} Immediate/Short-term habitations needing relocation.
      </div>
    );
  }

  return (
    <div className="mb-4 rounded border border-zone-red/50 bg-zone-red/10 p-3">
      <p className="text-sm font-semibold text-zone-red">
        {districtName} lacks sufficient safe land to relocate everyone who needs to move
      </p>
      <p className="mt-1 text-xs leading-relaxed text-mist-200">
        Of {needsRelocation} Immediate/Short-term priority habitations, only {matched} currently have a candidate
        relocation site with enough remaining carrying capacity. <strong>{noSite}</strong>{" "}
        {noSite === 1 ? "does" : "do"} not — see below.
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-[11px] font-medium text-zone-red underline decoration-dotted underline-offset-2"
      >
        {expanded ? "Hide" : "Show"} the {unmatchedRecs.length} unmatched habitation
        {unmatchedRecs.length === 1 ? "" : "s"}
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1.5 border-t border-zone-red/30 pt-2">
          {unmatchedRecs.map((r) => (
            <li key={r._id} className="text-[11px] leading-relaxed text-mist-300">
              <span className="font-medium text-mist-100">{r.habitationId.name}</span> — {r.rationale}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
