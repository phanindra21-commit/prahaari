import type { ChainVerification } from "../../lib/api";

/** The "chain verified" indicator (Step 7 Commit 3E): calls through to
 * GET /recommendations/:id/audit-trail's `chainVerification`, which is
 * `lib/audit.ts`'s `verifyAuditChain()` result — recomputed hash-chain
 * integrity across the WHOLE AuditLog, not just this recommendation's
 * entries (there is no narrower "verify these N entries" check; the chain
 * is one sequence). A broken link anywhere invalidates the badge everywhere. */
export function ChainVerifiedBadge({ chain }: { chain: ChainVerification }): JSX.Element {
  if (chain.valid) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded border border-zone-green/40 bg-zone-green/10 px-2 py-1 text-[11px] font-medium text-zone-green"
        title={`Verified ${chain.entriesChecked.toLocaleString("en-IN")} audit log entries — hash chain intact.`}
      >
        <span aria-hidden>✓</span> Chain verified
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border border-zone-red/40 bg-zone-red/10 px-2 py-1 text-[11px] font-medium text-zone-red"
      title={chain.reason ?? "Hash chain verification failed."}
    >
      <span aria-hidden>⚠</span> Chain broken at seq {chain.brokenAtSeq ?? "?"}
    </span>
  );
}
