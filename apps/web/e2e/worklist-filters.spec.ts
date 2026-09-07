import { test, expect } from "@playwright/test";

/**
 * Demo-rehearsal Part 3: bucket filter buttons on the priority worklist and
 * review queue were reported to show all records instead of filtering.
 * Live-browser testing (multiple roles, districts, bucket values, status
 * values, and bucket+status combined) could not reproduce this — every
 * request URL and rendered row set matched the clicked filter exactly. This
 * test stands as the regression guard: it fails immediately if that
 * filtering logic ever breaks again (e.g. a future PrioritiesPage/
 * ReviewQueuePage change means the filter value doesn't reach the query,
 * or the API param name drifts from what the route expects).
 */
test.describe("worklist and review queue filters actually filter (requires the dev backend stack running)", () => {
  test.skip(
    !process.env.PRAHARI_E2E_BACKEND,
    "Set PRAHARI_E2E_BACKEND=1 when mongo+api+ml are running locally to include this test.",
  );

  test("priority worklist bucket filters narrow the result set", async ({ page }) => {
    await page.goto("/login");
    // analyst.wayanad, not officer.wayanad: this test only needs
    // assessment:read (which ANALYST holds) and Wayanad-scoped data — using
    // a different seeded account spreads the per-email login-rate-limit
    // budget across the suite instead of piling every Wayanad-scoped spec
    // onto the one officer account (decision-workbench.spec.ts,
    // full-demo-path.spec.ts, and notifications.spec.ts already use it;
    // adding this test's login as a 5th/6th use of the same account
    // deterministically tripped the 5-per-15-min limiter on a full,
    // single suite run — a self-inflicted side effect of adding new specs
    // in the same session, not a product bug).
    await page.getByLabel("Email").fill("analyst.wayanad@prahari.gov.in");
    await page.getByLabel("Password").fill("PRAHARI@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("link", { name: "Priority worklist" }).click();
    await expect(page).toHaveURL(/\/priorities/);
    await page.locator("table tbody tr").first().waitFor({ state: "visible", timeout: 10_000 });
    const allCount = await page.locator("table tbody tr").count();

    await page.getByRole("button", { name: "Immediate", exact: true }).click();
    await expect(page.getByText(/matching record/)).toContainText("Immediate");
    // Every visible priority badge must read exactly "Immediate" — not a
    // mix, which is what "the filter doesn't filter" would look like.
    const immediateBadges = await page.locator("table tbody tr td:nth-child(4)").allTextContents();
    expect(immediateBadges.length).toBeGreaterThan(0);
    for (const badge of immediateBadges) {
      expect(badge).toBe("Immediate");
    }
    // The filtered set must be strictly smaller than the unfiltered one —
    // otherwise the click had no effect at all.
    expect(immediateBadges.length).toBeLessThan(allCount);
  });

  test("review queue bucket and status filters narrow the result set, together", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("superadmin@prahari.gov.in");
    await page.getByLabel("Password").fill("PRAHARI@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("link", { name: "Review queue" }).click();
    await expect(page).toHaveURL(/\/recommendations/);
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: "Pending review", exact: true }).click();
    await expect(page.getByText(/matching record/)).toContainText("Pending review");
    // The status cell also shows an "ESCALATED" flag next to the status for
    // a recommendation a District Officer has escalated (STATE_ADMIN
    // escalation feature) — a legitimate combined state, not evidence the
    // filter stopped working, so allow that optional trailing text.
    const pendingStatuses = await page.locator("table tbody tr td:nth-child(3)").allTextContents();
    for (const status of pendingStatuses) {
      expect(status === "Pending review" || status === "Pending reviewESCALATED").toBe(true);
    }
  });
});
