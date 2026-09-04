import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardDistrict } from "../../lib/api";
import { BUCKET_COLORS } from "../map/mapStyle";

const HAZARD_LABELS: Record<string, string> = {
  landslide: "Landslide",
  flood: "Flood",
  coastalErosion: "Coastal erosion",
  cloudburst: "Cloudburst",
};
const HAZARD_COLORS: Record<string, string> = {
  landslide: "#C6483C",
  flood: "#3E7CB1",
  coastalErosion: "#2FA9A0",
  cloudburst: "#8A67C7",
};

const CONSTRAINT_LABELS: Record<string, string> = {
  LAND: "Land",
  WATER: "Water",
  EDUCATION: "Education",
  HEALTH: "Health",
  ACCESS: "Access",
};
const CONSTRAINT_COLORS: Record<string, string> = {
  LAND: "#8A97A3",
  WATER: "#3E7CB1",
  EDUCATION: "#CE8A3E",
  HEALTH: "#C6483C",
  ACCESS: "#2FA9A0",
};

const BUCKET_LABELS: Record<string, string> = { Immediate: "Immediate", ShortTerm: "Short-term", MediumTerm: "Medium-term" };

const TOOLTIP_STYLE = {
  background: "#141B23",
  border: "1px solid #232E3A",
  borderRadius: 4,
  fontSize: 12,
  color: "#DCE2E7",
};

function ChartCard({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded border border-ink-600 bg-ink-800 p-3">
      <p className="mb-2 text-xs font-medium text-mist-200">{title}</p>
      {empty ? <p className="py-8 text-center text-xs text-mist-500">No data yet.</p> : <div className="h-48">{children}</div>}
    </div>
  );
}

/** Step 9 Part 1B: three restrained bar charts, no decorative styling —
 * dark-theme axes/gridlines, one series each, direct value labels via
 * tooltip rather than a legend. */
export function DashboardCharts({ district }: { district: DashboardDistrict }): JSX.Element {
  const bucketData = (Object.keys(district.bucketCounts) as Array<keyof typeof district.bucketCounts>).map((bucket) => ({
    bucket: BUCKET_LABELS[bucket],
    count: district.bucketCounts[bucket],
    fill: BUCKET_COLORS[bucket],
  }));

  const hazardData = (district.hazardDistribution ?? []).map((h) => ({
    hazard: HAZARD_LABELS[h.hazardType] ?? h.hazardType,
    count: h.count,
    fill: HAZARD_COLORS[h.hazardType] ?? "#8A97A3",
  }));

  const constraintData = (district.bindingConstraintDistribution ?? []).map((c) => ({
    constraint: CONSTRAINT_LABELS[c.bindingConstraint] ?? c.bindingConstraint,
    count: c.count,
    fill: CONSTRAINT_COLORS[c.bindingConstraint] ?? "#8A97A3",
  }));

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <ChartCard title="Priority bucket distribution" empty={bucketData.every((d) => d.count === 0)}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bucketData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#232E3A" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fill: "#8A97A3", fontSize: 11 }} axisLine={{ stroke: "#232E3A" }} tickLine={false} />
            <YAxis tick={{ fill: "#8A97A3", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#1B242E" }} />
            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
              {bucketData.map((entry) => (
                <Cell key={entry.bucket} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Habitations by governing hazard" empty={district.hazardDistribution === null || hazardData.length === 0}>
        {district.hazardDistribution === null ? (
          <p className="py-8 text-center text-xs text-mist-500">Requires assessment access.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hazardData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232E3A" vertical={false} />
              <XAxis dataKey="hazard" tick={{ fill: "#8A97A3", fontSize: 11 }} axisLine={{ stroke: "#232E3A" }} tickLine={false} />
              <YAxis tick={{ fill: "#8A97A3", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#1B242E" }} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {hazardData.map((entry) => (
                  <Cell key={entry.hazard} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard
        title="Carrying capacity — binding constraint"
        empty={district.bindingConstraintDistribution === null || constraintData.length === 0}
      >
        {district.bindingConstraintDistribution === null ? (
          <p className="py-8 text-center text-xs text-mist-500">Requires relocation-site access.</p>
        ) : constraintData.length === 0 ? (
          <p className="py-8 text-center text-xs text-mist-500">No scored candidate sites yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={constraintData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232E3A" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#8A97A3", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="constraint"
                tick={{ fill: "#8A97A3", fontSize: 11 }}
                axisLine={{ stroke: "#232E3A" }}
                tickLine={false}
                width={64}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#1B242E" }} />
              <Bar dataKey="count" radius={[0, 2, 2, 0]}>
                {constraintData.map((entry) => (
                  <Cell key={entry.constraint} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
