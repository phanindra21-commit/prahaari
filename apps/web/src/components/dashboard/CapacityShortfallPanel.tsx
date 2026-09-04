import type { DashboardCapacityShortfall } from "../../lib/api";

interface CapacityShortfallPanelProps {
  shortfall: DashboardCapacityShortfall | null;
  districtName: string;
}

/** Step 9 Part 1A: "the single most policy-relevant output the platform
 * produces" — given the most prominent position on the dashboard,
 * deliberately not just another stat tile. */
export function CapacityShortfallPanel({ shortfall, districtName }: CapacityShortfallPanelProps): JSX.Element | null {
  if (shortfall === null) {
    return (
      <div className="rounded border border-ink-600 bg-ink-800 px-4 py-3 text-xs text-mist-400">
        Capacity shortfall figures require relocation-site access, which your role does not have.
      </div>
    );
  }

  if (shortfall.needsRelocation === 0) {
    return (
      <div className="rounded border border-zone-green/40 bg-zone-green/10 px-4 py-3 text-sm text-zone-green">
        No habitations in {districtName} currently need relocation (no Immediate/Short-term priority habitations).
      </div>
    );
  }

  const hasGap = shortfall.noViableSite > 0;

  return (
    <div
      className={`rounded border p-4 ${hasGap ? "border-zone-red/50 bg-zone-red/10" : "border-zone-green/40 bg-zone-green/10"}`}
    >
      <p className={`text-sm font-semibold ${hasGap ? "text-zone-red" : "text-zone-green"}`}>
        {hasGap
          ? `${districtName}: insufficient safe land to relocate everyone who needs to move`
          : `${districtName}: a viable candidate site exists for every habitation that needs to move`}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="font-mono text-2xl font-semibold text-mist-50">{shortfall.needsRelocation}</p>
          <p className="text-[11px] text-mist-400">need relocation</p>
        </div>
        <div>
          <p className="font-mono text-2xl font-semibold text-zone-green">{shortfall.hasViableSite}</p>
          <p className="text-[11px] text-mist-400">have a viable site</p>
        </div>
        <div>
          <p className={`font-mono text-2xl font-semibold ${hasGap ? "text-zone-red" : "text-mist-50"}`}>
            {shortfall.noViableSite}
          </p>
          <p className="text-[11px] text-mist-400">do not</p>
        </div>
        <div>
          <p className={`font-mono text-2xl font-semibold ${hasGap ? "text-zone-red" : "text-mist-50"}`}>
            {shortfall.populationWithNoSite.toLocaleString("en-IN")}
          </p>
          <p className="text-[11px] text-mist-400">people with nowhere to go</p>
        </div>
      </div>
    </div>
  );
}
