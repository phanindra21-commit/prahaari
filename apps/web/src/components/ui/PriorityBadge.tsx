import type { RelocationPriorityBucket } from "@prahari/shared";

const BUCKET_STYLES: Record<RelocationPriorityBucket, string> = {
  Immediate: "bg-zone-red/20 text-zone-red border-zone-red/40",
  ShortTerm: "bg-zone-orange/20 text-zone-orange border-zone-orange/40",
  MediumTerm: "bg-signal/20 text-signal-bright border-signal/40",
};

const BUCKET_LABELS: Record<RelocationPriorityBucket, string> = {
  Immediate: "Immediate",
  ShortTerm: "Short-term",
  MediumTerm: "Medium-term",
};

export function PriorityBadge({ bucket }: { bucket: RelocationPriorityBucket | null }): JSX.Element {
  if (!bucket) {
    return (
      <span className="inline-flex items-center rounded border border-ink-500 px-1.5 py-0.5 text-[11px] text-mist-300">
        Not bucketed
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${BUCKET_STYLES[bucket]}`}
    >
      {BUCKET_LABELS[bucket]}
    </span>
  );
}
