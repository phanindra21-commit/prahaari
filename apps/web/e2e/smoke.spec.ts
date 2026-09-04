import { test, expect } from "@playwright/test";

/**
 * The regression test for the packages/shared CJS/ESM bug: typecheck,
 * lint, and `vite` serving the app all stayed green while the app was
 * completely broken in a real browser (a CommonJS-only dependency
 * build meant `permissionsConfig` was not a real ESM named export, so
 * the browser's module loader threw at import-evaluation time — before
 * React ever rendered anything, leaving a blank #root). None of those
 * checks execute real browser module resolution; this does, against
 * the actual production build (see playwright.config.ts's `webServer`).
 */
test("the login page renders real content, not a blank #root", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // A fresh, unauthenticated visitor's silent session-check
    // (POST /auth/refresh with no session cookie yet) legitimately 401s —
    // Chrome logs any non-2xx resource load as a console error regardless
    // of whether the app handled it (it does: authStore.bootstrap() reads
    // this as "not logged in" and moves on). That is expected traffic on
    // every first visit, not a bug; genuine JS errors (a thrown exception,
    // a module that failed to resolve/evaluate — the actual regression
    // this test exists to catch) are not this pattern and still fail below.
    if (/Failed to load resource.*401/.test(msg.text())) return;
    consoleErrors.push(msg.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/login");

  // The real regression signature: a module the browser could not
  // resolve/evaluate throws before React mounts, so #root stays empty
  // and nothing below ever appears.
  await expect(page.getByRole("heading", { name: "PunarVas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();

  expect(pageErrors, `Uncaught page errors: ${pageErrors.join("\n")}`).toHaveLength(0);
  expect(consoleErrors, `Console errors: ${consoleErrors.join("\n")}`).toHaveLength(0);
});

test.describe("authenticated (requires the dev backend stack running)", () => {
  test.skip(
    !process.env.PUNARVAS_E2E_BACKEND,
    "Set PUNARVAS_E2E_BACKEND=1 when mongo+api+ml are running locally to include this test.",
  );

  test("logging in loads the map with real hazard/habitation content", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("superadmin@punarvas.gov.in");
    await page.getByLabel("Password").fill("PunarVas@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/map/);
    // MapLibre renders its view into a <canvas> inside the container div.
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("SYNTHETIC_DEMO")).toBeVisible();
    await expect(page.getByText("Hazard zones")).toBeVisible();
  });
});
