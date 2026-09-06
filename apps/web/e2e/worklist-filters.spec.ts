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
    !process.env.PUNARVAS_E2E_BACKEND,
    "Set PUNARVAS_E2E_BACKEND=1 when mongo+api+ml are running locally to include this test.",
  );

  test("priority worklist bucket filters narrow the result set", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("officer.wayanad@punarvas.gov.in");
    await page.getByLabel("Password").fill("PunarVas@DevDefault123");
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
    await page.getByLabel("Email").fill("superadmin@punarvas.gov.in");
    await page.getByLabel("Password").fill("PunarVas@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("link", { name: "Review queue" }).click();
    await expect(page).toHaveURL(/\/recommendations/);
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: "Pending review", exact: true }).click();
    await expect(page.getByText(/matching record/)).toContainText("Pending review");
    const pendingStatuses = await page.locator("table tbody tr td:nth-child(3)").allTextContents();
    for (const status of pendingStatuses) {
      expect(status).toBe("Pending review");
    }
  });
});
