import { useParams } from "react-router-dom";
import { useDistricts, useHabitations, useHazardEvents, useFieldReports } from "../hooks/useApi";

const HAZARD_LABELS: Record<string, string> = {
  landslide: "Landslide",
  flood: "Flood",
  coastalErosion: "Coastal erosion",
  cloudburst: "Cloudburst",
};

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className="mb-2 mt-6 border-b-2 border-black pb-1 text-base font-semibold">{children}</h2>;
}

/**
 * Step 10 Part 4B: a field-appropriate report for FIELD_VOLUNTEER — this
 * role never held assessment:read/recommendation:read/decision:read, so
 * neither existing report (DistrictReportPage, HabitationReportPage) was
 * ever safe to hand it: both call queries this role 403s on, silently
 * rendering wrong/misleading placeholder text ("no recommendation
 * generated yet") instead of an honest access boundary. This report shows
 * only what the role can actually see: the district's habitations (name,
 * location, population, zone class — no RPI/vulnerability/risk score),
 * disaster history, and the signed-in volunteer's own submitted field
 * reports. Deliberately excludes recommendations and decisions.
 */
export function FieldReportPage(): JSX.Element {
  const { districtId } = useParams<{ districtId: string }>();
  const { data: districtsData, isLoading: districtsLoading } = useDistricts();
  const district = districtsData?.items.find((d) => d._id === districtId);
  const { data: habitations, isLoading: habitationsLoading } = useHabitations(districtId);
  const { data: events, isLoading: eventsLoading } = useHazardEvents(districtId);
  const { data: fieldReports, isLoading: fieldReportsLoading } = useFieldReports(districtId);

  const isLoading = districtsLoading || habitationsLoading || eventsLoading || fieldReportsLoading;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-black">
        <p className="text-sm">Loading report…</p>
      </div>
    );
  }

  if (!district) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-black">
        <p className="text-sm text-red-600">
          Could not load this district&apos;s report — it may not exist, or may be out of your scope.
        </p>
      </div>
    );
  }

  return (
    <div className="print-report h-full overflow-y-auto bg-white text-black">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-ink-600 bg-ink-900 px-4 py-2">
        <p className="text-xs text-mist-300">Print preview — {district.name} field report</p>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded border border-signal-bright/60 bg-signal/10 px-3 py-1.5 text-xs font-medium text-signal-bright hover:bg-signal/20"
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="mx-auto max-w-3xl px-8 py-6 text-sm leading-relaxed">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          PRAHARI — प्रहरी, &ldquo;sentinel&rdquo;
        </p>
        <p className="mb-1 inline-block rounded border border-black px-2 py-0.5 font-mono text-[10px] font-semibold">
          SYNTHETIC_DEMO
        </p>
        <h1 className="text-xl font-bold">Field Report — {district.name}, {district.state}</h1>
        <p className="text-xs text-gray-600">
          Generated {new Date().toLocaleString("en-IN")} · Population {district.population.toLocaleString("en-IN")} ·
          Primary hazards: {district.primaryHazards.map((h) => HAZARD_LABELS[h] ?? h).join(", ")}
        </p>

        <div className="mt-3 rounded border border-black bg-gray-50 p-3 text-xs">
          <strong>Field reference only.</strong> This report does not include relocation recommendations or officer
          decisions — those require a review permission this account does not hold. Contact your district officer
          for relocation status.
        </div>

        <SectionTitle>Habitations in this district</SectionTitle>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="border border-gray-400 px-2 py-1">Habitation</th>
              <th className="border border-gray-400 px-2 py-1">Block / Panchayat</th>
              <th className="border border-gray-400 px-2 py-1 text-right">Population</th>
              <th className="border border-gray-400 px-2 py-1 text-right">Households</th>
              <th className="border border-gray-400 px-2 py-1">Zone</th>
            </tr>
          </thead>
          <tbody>
            {(habitations?.items ?? []).map((h) => (
              <tr key={h.id}>
                <td className="border border-gray-400 px-2 py-1">{h.name}</td>
                <td className="border border-gray-400 px-2 py-1">
                  {h.block}, {h.panchayat}
                </td>
                <td className="border border-gray-400 px-2 py-1 text-right">{h.population.toLocaleString("en-IN")}</td>
                <td className="border border-gray-400 px-2 py-1 text-right">{h.households.toLocaleString("en-IN")}</td>
                <td className="border border-gray-400 px-2 py-1">{h.assessment?.overallZoneClass ?? "Not assessed"}</td>
              </tr>
            ))}
            {(habitations?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5} className="border border-gray-400 px-2 py-3 text-center text-gray-500">
                  No habitations recorded for this district.
                </td>
              </tr>
            )}
          </tbody>
        </table>

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

        <SectionTitle>Your submitted field reports</SectionTitle>
        {fieldReports && fieldReports.items.length > 0 ? (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="border border-gray-400 px-2 py-1">Date</th>
                <th className="border border-gray-400 px-2 py-1">Habitation</th>
                <th className="border border-gray-400 px-2 py-1">Observation</th>
                <th className="border border-gray-400 px-2 py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {fieldReports.items.map((r) => (
                <tr key={r._id}>
                  <td className="border border-gray-400 px-2 py-1">
                    {new Date(r.createdAt).toLocaleDateString("en-IN")}
                  </td>
                  <td className="border border-gray-400 px-2 py-1">{r.habitationId.name}</td>
                  <td className="border border-gray-400 px-2 py-1">{r.observationType}</td>
                  <td className="border border-gray-400 px-2 py-1">{r.verificationStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-gray-600">
            No field reports submitted yet — ground-truth report submission is not yet built in this build.
          </p>
        )}

        <p className="mt-6 border-t border-gray-400 pt-2 text-[10px] text-gray-500">
          SYNTHETIC_DEMO — PRAHARI is a decision-support tool. This report is for field reference only and carries
          no relocation decision content.
        </p>
      </div>
    </div>
  );
}
