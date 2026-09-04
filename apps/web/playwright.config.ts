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
