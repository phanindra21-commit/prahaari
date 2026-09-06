import { QueryClient } from "@tanstack/react-query";

/**
 * A module-level singleton so authStore.clearSession() can clear it
 * without a circular import into main.tsx. Demo-rehearsal Part 2 finding:
 * this cache used to survive a logout, so every query result (districts,
 * zones, habitations, recommendations, ...) from the previous user could
 * still render — cached data is served immediately even past staleTime —
 * for a different user signing in afterward in the same tab. Cleared on
 * every clearSession() call (authStore.ts) so a fresh login always starts
 * from an empty cache, never a stale cross-user one.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});
