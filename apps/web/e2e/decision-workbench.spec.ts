import { test, expect } from "@playwright/test";

/**
 * Step 7 Commit 3 real-browser verification: logs in as the seeded
 * Wayanad DISTRICT_OFFICER, opens the review queue, opens a
 * recommendation, submits a decision with a justification, and confirms
 * the chain-verified badge renders — per this repo's standing rule that
 * typecheck passing is not evidence a UI actually renders (see
 * smoke.spec.ts's docstring on the CJS/ESM regression that passed every
 * static check while leaving a blank #root in a real browser).
 *
 * Requires the full dev stack (mongo + api + services/ml, seeded, with a
 * pipeline run already completed for Wayanad so at least one PENDING_REVIEW
 * recommendation exists) — same PUNARVAS_E2E_BACKEND=1 gate as smoke.spec.ts.
 */
test.describe("officer decision workbench (requires the dev backend stack running)", () => {
  test.skip(
    !process.env.PUNARVAS_E2E_BACKEND,
    "Set PUNARVAS_E2E_BACKEND=1 when mongo+api+ml are running locally, seeded, with a completed Wayanad pipeline run.",
  );

  test("review queue -> recommendation detail -> decision -> chain verified", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("officer.wayanad@punarvas.gov.in");
    await page.getByLabel("Password").fill("PunarVas@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("link", { name: "Review queue" }).click();
    await expect(page).toHaveURL(/\/recommendations$/);

    // 3G: the capacity-shortfall headline finding must be visible, not buried.
    await expect(page.getByText(/lacks sufficient safe land|has a viable candidate site for every/)).toBeVisible({
      timeout: 10_000,
    });

    // Filter to a still-undecided recommendation so this test is safe to
    // re-run against a database where an earlier run already decided one.
    await page.getByRole("button", { name: "Pending review" }).click();
    const firstRow = page.locator("table tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    await firstRow.click();

    await expect(page).toHaveURL(/\/recommendations\/[0-9a-f]{24}$/);
    await expect(page.getByText("Habitation & risk story")).toBeVisible();
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Ranked candidate sites")).toBeVisible();
    await expect(page.getByText("Record a decision")).toBeVisible();

    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const justification = page.getByPlaceholder(/Explain the basis for this decision/);
    await justification.fill(
      "Approving relocation to the top-ranked candidate site after reviewing suitability and carrying capacity — verified via Playwright e2e run.",
    );
    await page.getByRole("button", { name: /Submit Approve/ }).click();

    await expect(page.getByText("Decision recorded.")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Chain verified")).toBeVisible({ timeout: 10_000 });
  });
});
