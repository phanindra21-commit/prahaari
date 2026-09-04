interface ProvenanceFooterProps {
  modelVersion?: string;
  computedAt?: string;
  dataProvenance?: string;
}

/** Required on every panel that shows a model output — see docs/METHODOLOGY.md
 * and CLAUDE.md: recommendations are advisory, never auto-executed, and
 * synthetic data must be labelled everywhere it surfaces. */
export function ProvenanceFooter({ modelVersion, computedAt, dataProvenance }: ProvenanceFooterProps): JSX.Element {
  return (
    <div className="border-t border-ink-600 bg-ink-900 px-3 py-2 text-[11px] leading-relaxed text-mist-300">
      <p className="font-mono">
        {dataProvenance ?? "SYNTHETIC_DEMO"}
        {modelVersion ? ` · model ${modelVersion}` : ""}
        {computedAt ? ` · computed ${new Date(computedAt).toLocaleString()}` : ""}
      </p>
      <p className="mt-0.5">
        Advisory only — every recommendation requires review and written justification from an
        authorized officer before it takes effect.
      </p>
    </div>
  );
}
