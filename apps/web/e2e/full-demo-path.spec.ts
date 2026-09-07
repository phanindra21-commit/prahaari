import { test, expect } from "@playwright/test";

/**
 * Step 9 Part 3E — THE demo path, verified as one continuous flow, not
 * as separate specs that happen to cover the same ground piecewise:
 *
 *   login as officer.wayanad -> dashboard -> map -> click a habitation
 *   -> open its recommendation -> approve with justification -> see the
 *   chain-verified badge -> run a scenario -> see the delta.
 *
 * "Click a habitation" is done via the priorities worklist (a table row
 * labeled with the habitation's name) rather than a raw canvas
 * pixel-coordinate click on the MapLibre canvas — MapLibre renders
 * habitations as canvas dots, not DOM elements, so a coordinate click
 * would be a fragile proxy for "click Chooralmala" (dependent on exact
 * viewport/zoom/pan state) where a named, semantic selection is not.
 * Selecting a row here drives the exact same `/map?habitation=<id>`
 * state a real canvas click would.
 *
 * Requires the full dev stack (mongo + api + services/ml), seeded, with
 * a completed Wayanad pipeline run leaving at least one PENDING_REVIEW
 * recommendation — same PRAHARI_E2E_BACKEND=1 gate as the other
 * standing e2e specs.
 */
test.describe("the full demo path (requires the dev backend stack running)", () => {
  test.skip(
    !process.env.PRAHARI_E2E_BACKEND,
    "Set PRAHARI_E2E_BACKEND=1 when mongo+api+ml are running locally, seeded, with a completed Wayanad pipeline run.",
  );

  test("login -> dashboard -> map -> habitation -> recommendation -> approve -> chain verified -> scenario -> delta", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // login -> dashboard
    await page.goto("/login");
    await page.getByLabel("Email").fill("officer.wayanad@prahari.gov.in");
    await page.getByLabel("Password").fill("PRAHARI@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Habitations assessed")).toBeVisible({ timeout: 15_000 });

    // dashboard -> map
    await page.getByRole("link", { name: "Map" }).click();
    await expect(page).toHaveURL(/\/map/);
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 15_000 });

    // -> click a habitation (Chooralmala, via the priorities worklist — see docstring)
    await page.getByRole("link", { name: "Priority worklist" }).click();
    await expect(page).toHaveURL(/\/priorities/);
    const chooralmalaRow = page.locator("table tbody tr", { hasText: "Chooralmala" });
    await expect(chooralmalaRow).toBeVisible({ timeout: 10_000 });
    await chooralmalaRow.click();
    await expect(page).toHaveURL(/\/map\?habitation=/);
    await expect(page.getByRole("heading", { name: "Chooralmala" })).toBeVisible({ timeout: 10_000 });

    // -> open its recommendation
    const viewRecommendation = page.getByText("View recommendation");
    await expect(viewRecommendation).toBeVisible({ timeout: 10_000 });
    await viewRecommendation.click();
    await expect(page).toHaveURL(/\/recommendations\/[0-9a-f]{24}$/);
    await expect(page.getByRole("heading", { name: "Chooralmala" })).toBeVisible();

    // If an earlier run of this same spec (against this session's shared
    // persistent database — Step 9 Part 3A) already decided Chooralmala's
    // recommendation, fall back to any other still-pending one so the
    // rest of the sequence (approve -> chain verified -> scenario) still
    // runs end to end rather than hard-failing on stale demo data.
    const alreadyDecided = await page.getByText("Already decided").isVisible().catch(() => false);
    if (alreadyDecided) {
      await page.getByRole("link", { name: "Review queue", exact: true }).click();
      await page.getByRole("button", { name: "Pending review" }).click();
      const anyPendingRow = page.locator("table tbody tr").first();
      await expect(anyPendingRow).toBeVisible({ timeout: 10_000 });
      await anyPendingRow.click();
      await expect(page).toHaveURL(/\/recommendations\/[0-9a-f]{24}$/);
    }

    // -> approve with justification
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page
      .getByPlaceholder(/Explain the basis for this decision/)
      .fill("Approving relocation after reviewing suitability and carrying capacity — full demo path e2e run.");
    await page.getByRole("button", { name: /Submit Approve/ }).click();
    await expect(page.getByText("Decision recorded.")).toBeVisible({ timeout: 10_000 });

    // -> see the chain-verified badge
    await expect(page.getByText("Chain verified")).toBeVisible({ timeout: 10_000 });

    // -> run a scenario -> see the delta
    await page.getByRole("link", { name: "Map" }).click();
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Scenario simulator")).toBeVisible();
    await page.getByRole("button", { name: "2024 Wayanad event: 372 mm/24h" }).first().click();
    await page.getByRole("button", { name: "Run scenario" }).click();
    await expect(page.getByText(/SCENARIO MODE/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("cells change class")).toBeVisible();
    await expect(page.getByText("Per-hazard cell shift")).toBeVisible();
  });
});
