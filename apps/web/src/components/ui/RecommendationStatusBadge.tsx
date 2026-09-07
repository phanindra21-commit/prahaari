import type { RecommendationStatus } from "@prahari/shared";

const STATUS_STYLES: Record<RecommendationStatus, string> = {
  PENDING_REVIEW: "border-ink-500 text-mist-300",
  APPROVED: "border-zone-green/40 bg-zone-green/20 text-zone-green",
  MODIFIED: "border-zone-orange/40 bg-zone-orange/20 text-zone-orange",
  REJECTED: "border-zone-red/40 bg-zone-red/20 text-zone-red",
  DEFERRED: "border-zone-yellow/40 bg-zone-yellow/20 text-zone-yellow",
};

const STATUS_LABELS: Record<RecommendationStatus, string> = {
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  MODIFIED: "Modified",
  REJECTED: "Rejected",
  DEFERRED: "Deferred",
};

export function RecommendationStatusBadge({ status }: { status: RecommendationStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
