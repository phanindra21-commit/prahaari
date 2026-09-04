import { Link } from "react-router-dom";
import type { DashboardRecentDecision } from "../../lib/api";

const ACTION_LABELS: Record<string, string> = {
  APPROVE: "Approved",
  MODIFY: "Modified",
  REJECT: "Rejected",
  DEFER: "Deferred",
};

const ACTION_COLORS: Record<string, string> = {
  APPROVE: "text-zone-green",
  MODIFY: "text-zone-orange",
  REJECT: "text-zone-red",
  DEFER: "text-zone-yellow",
};

/** Step 9 Part 1D: "recent activity" sourced from the already-scoped
 * Decision collection (decision:read) — not the broad auditLog:read
 * permission, which is never granted to DISTRICT_OFFICER (see
 * docs/SECURITY.md and dashboard.routes.ts's module docstring). */
export function RecentActivityFeed({ decisions }: { decisions: DashboardRecentDecision[] | null }): JSX.Element {
  if (decisions === null) {
    return (
      <div className="rounded border border-ink-600 bg-ink-800 px-4 py-3 text-xs text-mist-400">
        Recent activity requires decision access, which your role does not have.
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <div className="rounded border border-ink-600 bg-ink-800 px-4 py-6 text-center text-sm text-mist-400">
        No decisions recorded yet for this district.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {decisions.map((d) => (
        <li key={d.decisionId} className="rounded border border-ink-600 bg-ink-800 p-2.5 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <Link to={`/recommendations/${d.recommendationId}`} className="font-medium text-signal-bright hover:underline">
              <span className={ACTION_COLORS[d.action] ?? "text-mist-100"}>{ACTION_LABELS[d.action] ?? d.action}</span>
            </Link>
            <span className="text-mist-400">{new Date(d.decidedAt).toLocaleString("en-IN")}</span>
          </div>
          <p className="mb-1 text-mist-300">by {d.officerName}</p>
          <p className="leading-relaxed text-mist-400">&ldquo;{d.justification}&rdquo;</p>
        </li>
      ))}
    </ul>
  );
}
