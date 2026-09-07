import { create } from "zustand";
import type { SafeUser } from "@prahari/shared";
import { API_BASE_URL } from "../lib/apiClient";
import { queryClient } from "../lib/queryClient";
import { useDistrictStore } from "./districtStore";

/**
 * Matches Step 3's rotation scheme (apps/api/src/routes/auth.routes.ts):
 * the refresh token itself is an httpOnly cookie the browser holds and
 * sends automatically on same-site requests to /auth/** — this store
 * never sees it. Only the short-lived (15m) access token lives here, in
 * memory only (never localStorage — an XSS payload that can read
 * localStorage can exfiltrate a bearer token as easily as read it, and a
 * page reload re-establishing the session via the httpOnly cookie is an
 * acceptable cost for not persisting it).
 */
interface AuthState {
  user: SafeUser | null;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  setSession: (user: SafeUser, accessToken: string, expiresAt: string) => void;
  clearSession: () => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/** Proactively refreshes ~90s before the access token expires, so a user
 * mid-task never hits a reactive 401 in the common case. apiClient.ts
 * still handles the reactive 401 -> refresh -> retry path as a fallback
 * (e.g. this tab was asleep past the scheduled fire). */
function scheduleRefresh(expiresAt: number): void {
  clearRefreshTimer();
  const delay = Math.max(expiresAt - Date.now() - 90_000, 5_000);
  refreshTimer = setTimeout(() => {
    void refreshSession();
  }, delay);
}

async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      useAuthStore.getState().clearSession();
      return false;
    }
    const body = (await res.json()) as { accessToken: string; accessTokenExpiresAt: string };
    const current = useAuthStore.getState().user;
    if (current) {
      useAuthStore.getState().setSession(current, body.accessToken, body.accessTokenExpiresAt);
    }
    return true;
  } catch {
    useAuthStore.getState().clearSession();
    return false;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  accessTokenExpiresAt: null,
  status: "idle",
  error: null,

  setSession(user, accessToken, expiresAt) {
    const expiresAtMs = new Date(expiresAt).getTime();
    set({ user, accessToken, accessTokenExpiresAt: expiresAtMs, status: "authenticated", error: null });
    scheduleRefresh(expiresAtMs);
  },

  clearSession() {
    clearRefreshTimer();
    set({ user: null, accessToken: null, accessTokenExpiresAt: null, status: "unauthenticated" });
    useDistrictStore.getState().clearSelectedDistrictId();
    // See queryClient.ts's doc comment: without this, a different user
    // logging in in the same tab could still see the previous user's
    // cached query results (districts, zones, habitations, ...).
    queryClient.clear();
  },

  async login(email, password) {
    set({ status: "loading", error: null });
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json()) as
        | { accessToken: string; accessTokenExpiresAt: string; user: SafeUser }
        | { error: string };
      if (!res.ok || !("accessToken" in body)) {
        const message = "error" in body ? body.error : "Login failed";
        set({ status: "unauthenticated", error: message });
        throw new Error(message);
      }
      get().setSession(body.user, body.accessToken, body.accessTokenExpiresAt);
    } catch (error) {
      if (get().status !== "unauthenticated") {
        set({ status: "unauthenticated", error: error instanceof Error ? error.message : "Login failed" });
      }
      throw error;
    }
  },

  async logout() {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      get().clearSession();
    }
  },

  /** Called once on app load: the refresh cookie may still be valid from a
   * previous session even though this store starts empty every reload.
   * Network failures (offline, CORS misconfiguration, the API being down)
   * must resolve to "unauthenticated" — same as a clean 401 — never an
   * uncaught rejection: this runs unconditionally on every page load,
   * including the login page itself, so a thrown fetch here must not be
   * able to wedge the app in "loading" forever. */
  async bootstrap() {
    set({ status: "loading" });
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        set({ status: "unauthenticated" });
        return;
      }
      const body = (await res.json()) as { accessToken: string; accessTokenExpiresAt: string };
      const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${body.accessToken}` },
      });
      if (!meRes.ok) {
        set({ status: "unauthenticated" });
        return;
      }
      const meBody = (await meRes.json()) as { user: SafeUser };
      get().setSession(meBody.user, body.accessToken, body.accessTokenExpiresAt);
    } catch {
      set({ status: "unauthenticated" });
    }
  },
}));

export { refreshSession };
