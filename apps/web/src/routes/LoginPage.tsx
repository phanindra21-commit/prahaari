import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

export function LoginPage(): JSX.Element {
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (status === "authenticated") {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      // authStore already recorded the error message; nothing further to do here.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-mist-50">
            PRAHARI <span className="text-mist-400">— प्रहरी, &ldquo;sentinel&rdquo;</span>
          </h1>
          <p className="mt-1 text-sm text-mist-300">Hazard zoning and relocation decision support</p>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="rounded border border-ink-600 bg-ink-800 p-6 shadow-panel"
        >
          <div className="mb-4">
            <label htmlFor="email" className="mb-1 block text-xs text-mist-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-50 focus-visible:border-signal-bright"
            />
          </div>

          <div className="mb-5">
            <label htmlFor="password" className="mb-1 block text-xs text-mist-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-50 focus-visible:border-signal-bright"
            />
          </div>

          {error && (
            <p className="mb-4 rounded border border-zone-red/40 bg-zone-red/10 px-3 py-2 text-sm text-zone-red">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-signal px-3 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-signal-bright disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-mist-400">
          SYNTHETIC_DEMO data · Wayanad and Ganjam pilot districts
        </p>
      </div>
    </div>
  );
}
