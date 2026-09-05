import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useDashboardSummary } from "../hooks/useApi";
import { CapacityShortfallPanel } from "../components/dashboard/CapacityShortfallPanel";
import { DashboardCharts } from "../components/dashboard/DashboardCharts";
import { NeedsAttentionTable } from "../components/dashboard/NeedsAttentionTable";
import { RecentActivityFeed } from "../components/dashboard/RecentActivityFeed";
import { DistrictBreakdownTable } from "../components/dashboard/DistrictBreakdownTable";
import { ProvenanceFooter } from "../components/ui/ProvenanceFooter";

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="rounded border border-ink-600 bg-ink-800 p-3">
      <p className="font-mono text-xl font-semibold text-mist-50">{value}</p>
      <p className="text-[11px] text-mist-400">{label}</p>
      {sub && <p className="mt-0.5 text-[10px] text-mist-500">{sub}</p>}
    </div>
  );
}

export function DashboardPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, isError, error } = useDashboardSummary(undefined);
  const [selectedDistrictId, setSelectedDistrictId] = useState<string | null>(null);

  useEffect(() => {
    if (data && data.districts.length > 0 && !selectedDistrictId) {
      setSelectedDistrictId(data.districts[0]!.districtId);
    }
  }, [data, selectedDistrictId]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-mist-300">Loading dashboard…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="max-w-md text-center text-sm text-zone-red">
          Could not load the dashboard: {error instanceof Error ? error.message : "unknown error"}.
        </p>
      </div>
    );
  }

  if (!data || data.districts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="max-w-md text-center text-sm text-mist-300">
          No district is in your assigned scope yet. Contact your administrator to be assigned to a district.
        </p>
      </div>
    );
  }

  const isMultiDistrict = data.districts.length > 1;
  const selected = data.districts.find((d) => d.districtId === selectedDistrictId) ?? data.districts[0]!;
  const headline = isMultiDistrict && data.aggregate ? data.aggregate : selected;
  const headlineLabel = isMultiDistrict ? `${data.districts.length} districts (state total)` : selected.districtName;

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-baseline justify-between">
          <div>
            <h1 className="text-base font-semibold text-mist-50">
              {user ? `Welcome, ${user.name}` : "Dashboard"}
            </h1>
            <p className="text-xs text-mist-400">{headlineLabel}</p>
          </div>
          <Link
            to={`/reports/district/${selected.districtId}`}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-ink-500 px-3 py-1.5 text-xs text-mist-200 transition-colors hover:border-signal-bright/60 hover:text-signal-bright"
          >
            Download {selected.districtName} situation report
          </Link>
        </div>

        <section className="mb-4">
          <CapacityShortfallPanel shortfall={headline.capacityShortfall} districtName={headlineLabel} />
        </section>

        <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Habitations assessed" value={headline.habitationsAssessed.toLocaleString("en-IN")} />
          <StatTile
            label="Red / Orange zone"
            value={`${headline.redCount} / ${headline.orangeCount}`}
          />
          <StatTile
            label="Immediate priority"
            value={`${headline.bucketCounts.Immediate}`}
            sub={`${headline.immediatePopulation.toLocaleString("en-IN")} people, ${headline.immediateHouseholds.toLocaleString("en-IN")} households`}
          />
          <StatTile
            label="Pending decisions"
            value={headline.pendingDecisions === null ? "—" : headline.pendingDecisions.toLocaleString("en-IN")}
          />
        </section>

        {isMultiDistrict && (
          <section className="mb-4">
            <p className="mb-2 text-xs font-medium text-mist-300">District breakdown — select one for detail</p>
            <DistrictBreakdownTable
              districts={data.districts}
              selectedDistrictId={selected.districtId}
              onSelect={setSelectedDistrictId}
            />
          </section>
        )}

        <section className="mb-4">
          <p className="mb-2 text-xs font-medium text-mist-300">{selected.districtName} — charts</p>
          <DashboardCharts district={selected} />
        </section>

        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <p className="mb-2 text-xs font-medium text-mist-300">
              Needs attention — top {selected.needsAttention?.length ?? 0} by priority
            </p>
            <NeedsAttentionTable items={selected.needsAttention} />
          </section>
          <section>
            <p className="mb-2 text-xs font-medium text-mist-300">Recent activity</p>
            <RecentActivityFeed decisions={selected.recentDecisions} />
          </section>
        </div>

        <ProvenanceFooter />
      </div>
    </div>
  );
}
