import { useEffect, useState } from "react";
import { useDashboardSummary } from "../hooks/useApi";
import { ProvenanceFooter } from "../components/ui/ProvenanceFooter";
import {
  DEFAULT_ASSUMPTIONS,
  computeCost,
  formatRupees,
  type CostAssumptions,
} from "../lib/deploymentCost";

interface FieldSpec {
  key: keyof CostAssumptions;
  label: string;
  hint: string;
}

const FIELDS: FieldSpec[] = [
  { key: "districts", label: "Districts in pilot", hint: "count" },
  { key: "hostingPerMonth", label: "Cloud hosting", hint: "₹ per month" },
  { key: "analystPerMonth", label: "GIS / data analyst (part-time)", hint: "₹ per month" },
  { key: "analystMonths", label: "Analyst months in year one", hint: "months" },
  { key: "fieldValidationPerDistrict", label: "Field validation and survey travel", hint: "₹ per district" },
  { key: "recurringPerDistrictPerYear", label: "Running cost after pilot", hint: "₹ per district per year" },
];

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between border-b border-ink-600 py-1.5 last:border-b-0">
      <span className={strong ? "text-xs font-medium text-mist-100" : "text-xs text-mist-300"}>{label}</span>
      <span className={strong ? "font-mono text-sm font-semibold text-mist-50" : "font-mono text-xs text-mist-100"}>
        {value}
      </span>
    </div>
  );
}

export function DeploymentPage(): JSX.Element {
  const { data } = useDashboardSummary(undefined);
  const [a, setA] = useState<CostAssumptions>(DEFAULT_ASSUMPTIONS);

  // Start from the number of districts actually in this user's scope.
  const scopeDistricts = data?.districts.length ?? 0;
  useEffect(() => {
    if (scopeDistricts > 0) setA((prev) => ({ ...prev, districts: scopeDistricts }));
  }, [scopeDistricts]);

  const cost = computeCost(a);

  // Impact per rupee, assuming new districts look like the ones in scope today.
  const headline = data ? (data.districts.length > 1 && data.aggregate ? data.aggregate : data.districts[0]) : undefined;
  const perDistrictHabitations = headline && scopeDistricts > 0 ? headline.habitationsAssessed / scopeDistricts : 0;
  const perDistrictImmediatePeople = headline && scopeDistricts > 0 ? headline.immediatePopulation / scopeDistricts : 0;
  const habitations = perDistrictHabitations * a.districts;
  const immediatePeople = perDistrictImmediatePeople * a.districts;

  function setField(key: keyof CostAssumptions, raw: string): void {
    const n = Number(raw);
    setA((prev) => ({ ...prev, [key]: Number.isFinite(n) && n >= 0 ? n : prev[key] }));
  }

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-base font-semibold text-mist-50">Deployment cost and impact</h1>
        <p className="mb-4 text-xs text-mist-400">
          What it would take to run PRAHARI for a state or district disaster authority. Every figure below is an
          editable assumption, not a quote.
        </p>

        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded border border-ink-600 bg-ink-800 p-3">
            <p className="mb-2 text-xs font-medium text-mist-300">Assumptions</p>
            <div className="space-y-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-3 text-xs text-mist-300">
                  <span>
                    {f.label} <span className="text-mist-500">({f.hint})</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={a[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="w-28 rounded border border-ink-500 bg-ink-900 px-2 py-1 text-right font-mono text-xs text-mist-50"
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setA({ ...DEFAULT_ASSUMPTIONS, districts: scopeDistricts > 0 ? scopeDistricts : DEFAULT_ASSUMPTIONS.districts })}
              className="mt-3 rounded border border-ink-500 px-2 py-1 text-[11px] text-mist-300 hover:text-mist-100"
            >
              Reset to defaults
            </button>
          </section>

          <section className="rounded border border-ink-600 bg-ink-800 p-3">
            <p className="mb-2 text-xs font-medium text-mist-300">Year-one cost</p>
            <Row label="Cloud hosting" value={formatRupees(cost.hosting)} />
            <Row label="GIS / data analyst" value={formatRupees(cost.analyst)} />
            <Row label={`Field validation (${a.districts} districts)`} value={formatRupees(cost.fieldValidation)} />
            <Row label="Year-one total" value={formatRupees(cost.yearOneTotal)} strong />
            <Row label="Running cost per year after the pilot" value={formatRupees(cost.recurringPerYear)} strong />
          </section>
        </div>

        <section className="mb-4 rounded border border-ink-600 bg-ink-800 p-3">
          <p className="mb-2 text-xs font-medium text-mist-300">What that buys (based on the districts in your scope today)</p>
          {headline && habitations > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="font-mono text-lg font-semibold text-mist-50">{Math.round(habitations).toLocaleString("en-IN")}</p>
                <p className="text-[11px] text-mist-400">habitations assessed and ranked</p>
              </div>
              <div>
                <p className="font-mono text-lg font-semibold text-mist-50">{formatRupees(cost.yearOneTotal / habitations)}</p>
                <p className="text-[11px] text-mist-400">year-one cost per habitation</p>
              </div>
              <div>
                <p className="font-mono text-lg font-semibold text-mist-50">
                  {immediatePeople > 0 ? formatRupees(cost.yearOneTotal / immediatePeople) : "—"}
                </p>
                <p className="text-[11px] text-mist-400">year-one cost per person at Immediate priority</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-mist-400">Habitation figures appear once a district is assessed.</p>
          )}
          <p className="mt-2 text-[10px] text-mist-500">
            Habitation and population counts come from the current demonstration dataset, so treat these ratios as
            illustrative until real district data is loaded.
          </p>
        </section>

        <ProvenanceFooter />
      </div>
    </div>
  );
}
