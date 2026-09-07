import { test, expect } from "@playwright/test";

/**
 * STATE_ADMIN escalation exception: a District Officer escalates one
 * recommendation to State; a State Admin's decision controls appear ONLY
 * on that recommendation (not on an ordinary, non-escalated one); the
 * State Admin approves it; the audit trail shows the state-level marking
 * and the chain still verifies. See docs/SECURITY.md §4.1 for the
 * separation-of-duties reasoning this exercises end to end.
 *
 * Uses Chamoli (Deepika Bhandari, District Officer) / Uttarakhand (Harish
 * Rawat, State Admin) rather than Wayanad/Kerala deliberately: every other
 * standing e2e spec logs in as officer.wayanad@ at least once, and that
 * account's login-rate-limit budget (5 attempts/15min, apps/api's
 * loginRateLimiter) is already fully spent by the rest of the suite in one
 * run — adding a sixth use here reproduced exactly the suite-reliability
 * bug fixed for worklist-filters.spec.ts in the Step 10-continued session
 * (switched to analyst.wayanad@ for the same reason). Chamoli/Uttarakhand
 * sidesteps the shared budget entirely rather than trying to further
 * ration it. The scenario itself (real-browser-verified against Wayanad's
 * Priya Nair / Kerala's Ravi Varma during development of this feature) is
 * district/state-agnostic — this spec targets a different pilot district
 * only to keep the suite's login budget independent, not because the
 * feature behaves differently there.
 */
test.describe("STATE_ADMIN escalation exception (requires the dev backend stack running)", () => {
  test.skip(
    !process.env.PUNARVAS_E2E_BACKEND,
    "Set PUNARVAS_E2E_BACKEND=1 when mongo+api+ml are running locally, seeded, with a completed Chamoli pipeline run.",
  );

  test("District Officer escalates -> State Admin's controls appear only there -> approves -> audit trail marks it state-level", async ({
    page,
  }) => {
    // --- Deepika Bhandari (Chamoli District Officer) escalates one recommendation ---
    await page.goto("/login");
    await page.getByLabel("Email").fill("officer.chamoli@punarvas.gov.in");
    await page.getByLabel("Password").fill("PunarVas@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("link", { name: "Review queue" }).click();
    await expect(page).toHaveURL(/\/recommendations$/);
    await page.getByRole("button", { name: "Pending review" }).click();

    const escalateRow = page.locator("table tbody tr", { hasText: "Mana" }).first();
    await expect(escalateRow).toBeVisible({ timeout: 10_000 });
    await escalateRow.click();
    await expect(page).toHaveURL(/\/recommendations\/[0-9a-f]{24}$/);
    const escalatedUrl = page.url();

    await expect(page.getByText("Record a decision")).toBeVisible();
    await page.getByRole("button", { name: "Escalate to State" }).click();
    await page
      .getByPlaceholder(/Explain the basis for this decision/)
      .fill(
        "Escalating to State: this recommendation warrants state-level review before a final decision — verified via Playwright e2e run.",
      );
    await page.getByRole("button", { name: /Submit Escalate to State/ }).click();
    await expect(page.getByText("Decision recorded.")).toBeVisible({ timeout: 10_000 });

    // A second, ordinary (non-escalated) recommendation, for the negative check below.
    await page.goto("/recommendations");
    await page.getByRole("button", { name: "Pending review" }).click();
    const ordinaryRow = page.locator("table tbody tr", { hasNotText: "Mana" }).last();
    await expect(ordinaryRow).toBeVisible({ timeout: 10_000 });
    await ordinaryRow.click();
    await expect(page).toHaveURL(/\/recommendations\/[0-9a-f]{24}$/);
    const ordinaryUrl = page.url();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    // --- Harish Rawat (Uttarakhand State Admin) ---
    await page.getByLabel("Email").fill("stateadmin.uttarakhand@punarvas.gov.in");
    await page.getByLabel("Password").fill("PunarVas@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Restricted on the ordinary, non-escalated recommendation.
    await page.goto(ordinaryUrl);
    await expect(page.getByText("Approval restricted")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/this one has not been/)).toBeVisible();

    // Unlocked on the one Deepika Bhandari escalated.
    await page.goto(escalatedUrl);
    await expect(page.getByText(/^Escalated to State/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Record a decision")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page
      .getByPlaceholder(/Explain the basis for this decision/)
      .fill(
        "State-level approval of this escalated recommendation after reviewing suitability and capacity — verified via Playwright e2e run.",
      );
    await page.getByRole("button", { name: /Submit Approve/ }).click();
    await expect(page.getByText("Decision recorded.")).toBeVisible({ timeout: 10_000 });

    // Audit trail: state-level marking survives, and the chain still verifies.
    await expect(page.getByText("STATE-LEVEL")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Chain verified")).toBeVisible({ timeout: 10_000 });
  });
});
