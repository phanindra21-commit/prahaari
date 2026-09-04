import { test, expect } from "@playwright/test";

/**
 * Step 8 Part 2 real-browser verification: runs a fresh what-if scenario
 * from a named preset and confirms the delta summary, the persistent
 * "hypothetical, not official" banner, and the baseline/scenario map
 * toggle all render — the same PUNARVAS_E2E_BACKEND=1-gated pattern as
 * smoke.spec.ts and decision-workbench.spec.ts.
 */
test.describe("scenario simulator (requires the dev backend stack running)", () => {
  test.skip(
    !process.env.PUNARVAS_E2E_BACKEND,
    "Set PUNARVAS_E2E_BACKEND=1 when mongo+api+ml are running locally, seeded, with grid/factors generated for Wayanad.",
  );

  test("run a preset scenario and confirm the delta summary and scenario-mode banner render", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("officer.wayanad@punarvas.gov.in");
    await page.getByLabel("Password").fill("PunarVas@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.getByRole("link", { name: "Map" }).click();
    await expect(page).toHaveURL(/\/map/);
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Scenario simulator")).toBeVisible();
    // The preset button is the first match in DOM order (presets render
    // before the saved-scenarios list, which may already contain runs
    // with the same name from earlier sessions/manual testing).
    await page.getByRole("button", { name: "2024 Wayanad event: 372 mm/24h" }).first().click();
    await page.getByRole("button", { name: "Run scenario" }).click();

    await expect(page.getByText(/SCENARIO MODE/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("has NOT changed the official zoning")).toBeVisible();
    await expect(page.getByText("cells change class")).toBeVisible();
    await expect(page.getByText("Per-hazard cell shift")).toBeVisible();

    // Baseline/scenario toggle actually changes what the map (and banner) says it's showing.
    await expect(page.getByText(/Viewing:.*Scenario \(hypothetical\)/)).toBeVisible();
    await page.getByRole("button", { name: /Show baseline/ }).click();
    await expect(page.getByText(/Viewing:.*Baseline/)).toBeVisible();

    await page.getByRole("button", { name: "Exit scenario mode" }).click();
    await expect(page.getByText(/SCENARIO MODE/)).toHaveCount(0);
  });
});
