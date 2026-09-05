import { defineConfig, devices } from "@playwright/test";

/**
 * A real-browser smoke test for the BUILT app (`npm run build` +
 * `vite preview`) — not the dev server. This is the layer that catches
 * a class of failure typecheck/lint/dev-server-loads cannot: a
 * package resolved to a CommonJS-only build serving no named ESM
 * exports to the browser (packages/shared's CJS-only build silently
 * broke `permissionsConfig` for apps/web while every other check
 * stayed green). `webServer` builds and serves the production bundle
 * fresh for every run, so a regression here fails the way a real
 * deploy would.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  // Step 9 Part 3E: several specs log in as the same seeded officer
  // account. apps/api's login rate limiter is keyed by IP+email (5
  // attempts per 15 minutes) — every Playwright worker shares this
  // machine's one IP, so running specs across multiple parallel workers
  // can exhaust that budget and fail logins with a spurious 429, not a
  // real app bug. Serializing the suite avoids the concurrency entirely
  // rather than loosening a real anti-brute-force control. This is a
  // small, deliberately serial e2e suite; the runtime cost is minor.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
