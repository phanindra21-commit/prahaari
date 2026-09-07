import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Top-level render-error guard. React error boundaries must be class
 * components — there is no hook equivalent (useEffect cannot catch a
 * render-phase throw from a descendant).
 *
 * Without this, any uncaught render error (a bad API response shape, a
 * broken import, a null a component didn't guard) unmounts the whole
 * tree and leaves a blank #root with no indication anything went wrong
 * — unacceptable mid-demo, and exactly what happened when
 * packages/shared's CJS-only build made `permissionsConfig` resolve to
 * undefined in the browser. This renders the actual error and component
 * stack instead, so a broken deploy is legible, not silent.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen items-center justify-center bg-ink-950 p-6">
        <div className="w-full max-w-2xl rounded border border-zone-red/40 bg-ink-800 p-5 shadow-panel">
          <h1 className="mb-1 text-sm font-semibold text-zone-red">Something went wrong</h1>
          <p className="mb-3 text-xs text-mist-300">
            PRAHARI hit an unrecoverable rendering error. This is a bug, not something you can fix
            by retrying — reload the page, and if it persists, report the message below.
          </p>
          <pre className="scrollbar-thin mb-3 max-h-32 overflow-auto rounded border border-ink-600 bg-ink-900 p-2 text-xs text-mist-100">
            {error.message}
          </pre>
          {componentStack && (
            <details className="text-xs text-mist-400">
              <summary className="cursor-pointer text-mist-300">Component stack</summary>
              <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
                {componentStack}
              </pre>
            </details>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded bg-signal px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-signal-bright"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
