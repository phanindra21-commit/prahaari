import { useState } from "react";
import type { DecisionAction } from "@punarvas/shared";
import { useAuthStore } from "../../stores/authStore";
import { hasPermission } from "../../lib/permissions";
import { useCreateDecision } from "../../hooks/useApi";
import { ApiError } from "../../lib/apiClient";
import type { CreateDecisionOverride, PhasingPlanEntry, RecommendationItem } from "../../lib/api";

const MIN_JUSTIFICATION_LENGTH = 30;

const DECIDE_ACTIONS: Array<{ value: DecisionAction; label: string; style: string }> = [
  { value: "APPROVE", label: "Approve", style: "border-zone-green/50 text-zone-green hover:bg-zone-green/10" },
  { value: "MODIFY", label: "Modify", style: "border-zone-orange/50 text-zone-orange hover:bg-zone-orange/10" },
  { value: "REJECT", label: "Reject", style: "border-zone-red/50 text-zone-red hover:bg-zone-red/10" },
  { value: "DEFER", label: "Defer", style: "border-zone-yellow/50 text-zone-yellow hover:bg-zone-yellow/10" },
];

const ESCALATE_ACTION: { value: DecisionAction; label: string; style: string } = {
  value: "ESCALATE",
  label: "Escalate to State",
  style: "border-signal/50 text-signal-bright hover:bg-signal/10",
};

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

interface DecisionActionPanelProps {
  recommendation: RecommendationItem;
}

export function DecisionActionPanel({ recommendation }: DecisionActionPanelProps): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const isEscalated = recommendation.escalation.status === "ESCALATED";
  // Two structurally different ways to reach this panel: a district-level
  // approver (DISTRICT_OFFICER/SUPER_ADMIN) can always act; a state-level
  // approver (STATE_ADMIN/SUPER_ADMIN) can act ONLY on a recommendation a
  // District Officer has explicitly escalated — the server enforces this
  // exact rule independently (decision.routes.ts), this is only what the
  // UI shows.
  const canDecideAtDistrictLevel = user ? hasPermission(user.role, "recommendation:approve") : false;
  const canDecideAtStateLevel = user ? hasPermission(user.role, "recommendation:approveEscalated") : false;
  const canDecide = canDecideAtDistrictLevel || (canDecideAtStateLevel && isEscalated);
  // Escalating is a district-officer action (or SUPER_ADMIN on their
  // behalf) — a STATE_ADMIN, even one who can now decide an escalated
  // recommendation, never escalates one themselves.
  const canEscalate = canDecideAtDistrictLevel && !isEscalated;
  const availableActions = canEscalate ? [...DECIDE_ACTIONS, ESCALATE_ACTION] : DECIDE_ACTIONS;

  const [action, setAction] = useState<DecisionAction>("APPROVE");
  const [justification, setJustification] = useState("");
  const [siteId, setSiteId] = useState<string>(recommendation.selectedSiteId?._id ?? "");
  const [householdCount, setHouseholdCount] = useState<number>(recommendation.estimatedHouseholdsToMove);
  const currentPhase1 = recommendation.phasing[0];
  const [editPhasing, setEditPhasing] = useState(false);
  const [phaseHouseholds, setPhaseHouseholds] = useState<number>(
    currentPhase1?.householdCount ?? recommendation.estimatedHouseholdsToMove,
  );
  const [phaseDate, setPhaseDate] = useState<string>(
    toDateInputValue(currentPhase1?.targetDate ?? new Date().toISOString()),
  );

  const { mutate, isPending, error, isSuccess } = useCreateDecision();

  if (!user) {
    return <p className="text-xs text-mist-400">Sign in to review this recommendation.</p>;
  }

  if (!canDecide) {
    return (
      <div className="rounded border border-ink-600 bg-ink-800 p-3 text-xs text-mist-300">
        <p className="font-medium text-mist-100">Approval restricted</p>
        {canDecideAtStateLevel ? (
          <p className="mt-1 leading-relaxed">
            Your role ({user.role}) can act on a recommendation only after a District Officer has explicitly
            escalated it — this one has not been. State Admins normally cannot approve at all, since the role
            also holds write access to the underlying habitation/hazard/site data; escalation is the documented
            exception, not a general grant.
          </p>
        ) : (
          <p className="mt-1 leading-relaxed">
            Your role ({user.role}) can view this recommendation but cannot approve, modify, reject, defer, or
            escalate it. Only a District Officer or Super Admin may record a decision.
          </p>
        )}
      </div>
    );
  }

  // Checked BEFORE the "already decided" branch below: submitting a
  // decision changes `recommendation.status` away from PENDING_REVIEW,
  // and useCreateDecision()'s onSuccess invalidates the query this
  // component's `recommendation` prop is fed from — so on the very
  // re-render right after a successful submit, the status check below
  // would otherwise win the race and show "Already decided" instead of
  // ever showing the success message at all. `isSuccess` reflects THIS
  // mutation instance, not the recommendation's current status, so it
  // correctly stays true across that refetch-driven re-render.
  if (isSuccess) {
    return (
      <div className="rounded border border-zone-green/40 bg-zone-green/10 p-3 text-xs text-zone-green">
        Decision recorded. The recommendation status and audit trail below now reflect it.
      </div>
    );
  }

  if (recommendation.status !== "PENDING_REVIEW") {
    return (
      <div className="rounded border border-ink-600 bg-ink-800 p-3 text-xs text-mist-300">
        <p className="font-medium text-mist-100">Already decided</p>
        <p className="mt-1 leading-relaxed">
          This recommendation&apos;s status is {recommendation.status} — see the audit trail below for who decided
          and why. Each recommendation accepts exactly one decision.
        </p>
      </div>
    );
  }

  function buildOverrides(): CreateDecisionOverride[] {
    if (action !== "MODIFY") return [];
    const overrides: CreateDecisionOverride[] = [];

    const currentSiteId = recommendation.selectedSiteId?._id ?? null;
    if (siteId && siteId !== currentSiteId) {
      overrides.push({ field: "selectedSiteId", fromValue: currentSiteId, toValue: siteId });
    }
    if (householdCount !== recommendation.estimatedHouseholdsToMove) {
      overrides.push({
        field: "estimatedHouseholdsToMove",
        fromValue: recommendation.estimatedHouseholdsToMove,
        toValue: householdCount,
      });
    }
    if (editPhasing) {
      const newPhasing: PhasingPlanEntry[] = [
        { phase: 1, householdCount: phaseHouseholds, targetDate: new Date(phaseDate).toISOString() },
      ];
      if (JSON.stringify(newPhasing) !== JSON.stringify(recommendation.phasing)) {
        overrides.push({ field: "phasing", fromValue: recommendation.phasing, toValue: newPhasing });
      }
    }
    return overrides;
  }

  const overrides = buildOverrides();
  const justificationValid = justification.trim().length >= MIN_JUSTIFICATION_LENGTH;
  const modifyNeedsChange = action !== "MODIFY" || overrides.length > 0;
  const canSubmit = justificationValid && modifyNeedsChange && !isPending;

  function submit(): void {
    mutate({
      recommendationId: recommendation._id,
      action,
      justification: justification.trim(),
      overriddenFields: overrides,
    });
  }

  return (
    <div className="rounded border border-ink-600 bg-ink-800 p-3">
      <p className="mb-2 text-xs font-medium text-mist-200">Record a decision</p>

      {isEscalated && (
        <p className="mb-3 rounded border border-signal/40 bg-signal/10 px-2 py-1.5 text-[11px] leading-relaxed text-signal-bright">
          Escalated to State{recommendation.escalation.escalatedAt
            ? ` on ${new Date(recommendation.escalation.escalatedAt).toLocaleDateString("en-IN")}`
            : ""}
          {recommendation.escalation.reason ? `: "${recommendation.escalation.reason}"` : ""}
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {availableActions.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => setAction(a.value)}
            className={`flex-1 rounded border px-2 py-1.5 text-xs font-medium transition-colors ${
              action === a.value ? a.style + " bg-opacity-20" : "border-ink-600 text-mist-400 hover:text-mist-200"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {action === "MODIFY" && (
        <div className="mb-3 space-y-3 rounded border border-ink-700 bg-ink-900 p-2.5">
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-mist-300">Select a different candidate site</p>
            <div className="space-y-1">
              {recommendation.candidateSites.map((c) => (
                <label
                  key={c.relocationSiteId._id}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-mist-200 hover:bg-ink-800"
                >
                  <input
                    type="radio"
                    name="site"
                    checked={siteId === c.relocationSiteId._id}
                    onChange={() => setSiteId(c.relocationSiteId._id)}
                  />
                  <span>
                    #{c.rank} {c.relocationSiteId.name}
                  </span>
                  <span className="ml-auto font-mono text-mist-400">{c.suitabilityScore.toFixed(3)}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-mist-300">Households to move</label>
            <input
              type="number"
              min={0}
              value={householdCount}
              onChange={(e) => setHouseholdCount(Number(e.target.value))}
              className="w-full rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-mist-100"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-[11px] font-medium text-mist-300">
              <input type="checkbox" checked={editPhasing} onChange={(e) => setEditPhasing(e.target.checked)} />
              Adjust phase 1 plan
            </label>
            {editPhasing && (
              <div className="mt-1.5 flex gap-2">
                <input
                  type="number"
                  min={0}
                  value={phaseHouseholds}
                  onChange={(e) => setPhaseHouseholds(Number(e.target.value))}
                  className="w-1/2 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-mist-100"
                  placeholder="Households"
                />
                <input
                  type="date"
                  value={phaseDate}
                  onChange={(e) => setPhaseDate(e.target.value)}
                  className="w-1/2 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-mist-100"
                />
              </div>
            )}
          </div>

          {overrides.length === 0 && (
            <p className="rounded border border-zone-orange/40 bg-zone-orange/10 px-2 py-1.5 text-[11px] text-zone-orange">
              Change at least one field above to submit a Modify decision — the Submit button stays disabled until
              you do.
            </p>
          )}
        </div>
      )}

      <label className="mb-1 block text-[11px] font-medium text-mist-300">
        Justification (minimum {MIN_JUSTIFICATION_LENGTH} characters, required)
      </label>
      <textarea
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        rows={3}
        className="w-full resize-none rounded border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-mist-100 placeholder:text-mist-500"
        placeholder="Explain the basis for this decision — this is written to the permanent audit trail."
      />
      <p className={`mt-0.5 text-[10px] ${justificationValid ? "text-mist-500" : "text-zone-orange"}`}>
        {justification.trim().length} / {MIN_JUSTIFICATION_LENGTH} characters
      </p>
      {/* A native `disabled` button gives a real click zero feedback — this
       * repo's standing rule (CLAUDE.md: "officer actions are never silent")
       * means the reason the Submit button won't respond must be as visible
       * as a server error, not a 10px counter easy to miss at a glance. */}
      {!justificationValid && (
        <p className="mt-1.5 rounded border border-zone-orange/40 bg-zone-orange/10 px-2 py-1.5 text-[11px] text-zone-orange">
          Justification needs {MIN_JUSTIFICATION_LENGTH - justification.trim().length} more character
          {MIN_JUSTIFICATION_LENGTH - justification.trim().length === 1 ? "" : "s"} before this decision can be
          submitted.
        </p>
      )}

      {error && (
        <p className="mt-2 rounded border border-zone-red/40 bg-zone-red/10 px-2 py-1.5 text-[11px] text-zone-red">
          {error instanceof ApiError ? error.message : "Failed to record decision."}
        </p>
      )}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="mt-2.5 w-full rounded border border-signal-bright/60 bg-signal/10 py-1.5 text-xs font-medium text-signal-bright transition-colors hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-ink-600 disabled:bg-transparent disabled:text-mist-500"
      >
        {isPending ? "Submitting…" : `Submit ${availableActions.find((a) => a.value === action)?.label ?? action}`}
      </button>
    </div>
  );
}
