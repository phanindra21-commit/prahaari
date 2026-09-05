import { useRecommendationAuditTrail } from "../../hooks/useApi";
import { ChainVerifiedBadge } from "../ui/ChainVerifiedBadge";

const ACTION_LABELS: Record<string, string> = {
  APPROVE: "Approved",
  MODIFY: "Modified",
  REJECT: "Rejected",
  DEFER: "Deferred",
};

export function AuditTrailPanel({ recommendationId }: { recommendationId: string }): JSX.Element {
  const { data, isLoading, isError } = useRecommendationAuditTrail(recommendationId);

  if (isLoading) {
    return <p className="text-xs text-mist-400">Loading audit trail…</p>;
  }

  if (isError || !data) {
    return <p className="text-xs text-zone-red">Could not load the audit trail for this recommendation.</p>;
  }

  if (data.decisions.length === 0) {
    return <p className="text-xs text-mist-400">No decision has been recorded for this recommendation yet.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-mist-200">Decision &amp; audit trail</p>
        <ChainVerifiedBadge chain={data.chainVerification} />
      </div>

      <ul className="space-y-2">
        {data.decisions.map((decision) => {
          const entry = data.auditEntries.find((a) => a.entityId === decision._id);
          return (
            <li key={decision._id} className="rounded border border-ink-600 bg-ink-800 p-2.5 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-mist-100">{ACTION_LABELS[decision.action] ?? decision.action}</span>
                <span className="text-mist-400">{new Date(decision.decidedAt).toLocaleString("en-IN")}</span>
              </div>
              <p className="mb-1 text-mist-300">
                by {decision.officerId.name} <span className="text-mist-400">({decision.officerId.role})</span>
              </p>
              <p className="mb-1 leading-relaxed text-mist-300">&ldquo;{decision.justification}&rdquo;</p>
              {decision.overriddenFields.length > 0 && (
                <ul className="mt-1 space-y-0.5 border-t border-ink-700 pt-1">
                  {decision.overriddenFields.map((f, i) => (
                    <li key={i} className="font-mono text-[10px] text-mist-400">
                      {f.field}: {JSON.stringify(f.fromValue)} → {JSON.stringify(f.toValue)}
                    </li>
                  ))}
                </ul>
              )}
              {entry && (
                <p className="mt-1.5 truncate font-mono text-[10px] text-mist-500" title={entry.entryHash}>
                  audit seq {entry.seq} · hash {entry.entryHash.slice(0, 16)}…
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
