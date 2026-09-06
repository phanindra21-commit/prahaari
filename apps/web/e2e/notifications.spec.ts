import { test, expect } from "@playwright/test";

/**
 * Step 10 Part 6: approving a recommendation notifies STATE_ADMIN,
 * DISTRICT_OFFICER, and ANALYST in scope (never the deciding officer,
 * never FIELD_VOLUNTEER — see notifications.ts's doc comment and the
 * matching unit coverage in decision.routes.test.ts). This verifies the
 * bell actually renders that in a real browser, and — the part a unit
 * test can't cover — that a different district's officer, who received
 * no notification, sees no badge at all: the exact class of leak this
 * project's own history has repeatedly found in query-param scoping
 * (Step 9's ?districtId= bypass), now checked for the bell too.
 */
test.describe("notification bell (requires the dev backend stack running)", () => {
  test.skip(
    !process.env.PUNARVAS_E2E_BACKEND,
    "Set PUNARVAS_E2E_BACKEND=1 when mongo+api+ml are running locally, seeded, with a completed Wayanad pipeline run.",
  );

  test("approving a Wayanad recommendation notifies the Wayanad analyst but not the Ganjam officer", async ({
    browser,
  }) => {
    const officerContext = await browser.newContext();
    const officerPage = await officerContext.newPage();
    await officerPage.goto("/login");
    await officerPage.getByLabel("Email").fill("officer.wayanad@punarvas.gov.in");
    await officerPage.getByLabel("Password").fill("PunarVas@DevDefault123");
    await officerPage.getByRole("button", { name: "Sign in" }).click();
    await expect(officerPage).toHaveURL(/\/dashboard/);

    await officerPage.getByRole("link", { name: "Review queue" }).click();
    await expect(officerPage).toHaveURL(/\/recommendations$/);
    await officerPage.getByRole("button", { name: "Pending review" }).click();
    const firstRow = officerPage.locator("table tbody tr", { hasNotText: "Chooralmala" }).first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    const habitationName = (await firstRow.locator("td").first().innerText()).split("(")[0].trim();
    await firstRow.click();
    await expect(officerPage).toHaveURL(/\/recommendations\/[0-9a-f]{24}$/);

    await officerPage.getByRole("button", { name: "Approve", exact: true }).click();
    await officerPage
      .getByPlaceholder(/Explain the basis for this decision/)
      .fill("Approving for the notification bell e2e check — verified via Playwright.");
    await officerPage.getByRole("button", { name: /Submit Approve/ }).click();
    await expect(officerPage.getByText("Decision recorded.")).toBeVisible({ timeout: 10_000 });
    await officerContext.close();

    const analystContext = await browser.newContext();
    const analystPage = await analystContext.newPage();
    await analystPage.goto("/login");
    await analystPage.getByLabel("Email").fill("analyst.wayanad@punarvas.gov.in");
    await analystPage.getByLabel("Password").fill("PunarVas@DevDefault123");
    await analystPage.getByRole("button", { name: "Sign in" }).click();
    await expect(analystPage).toHaveURL(/\/dashboard/);

    const bellButton = analystPage.getByRole("button", { name: /Notifications/ });
    await expect(bellButton).toBeVisible();
    // A badge with a non-zero count must be present — poll briefly since
    // this landed via a fresh page load right after the decision.
    await expect(async () => {
      const label = await bellButton.getAttribute("aria-label");
      expect(label).toMatch(/\d+ unread/);
    }).toPass({ timeout: 10_000 });

    await bellButton.click();
    await expect(analystPage.getByText(habitationName, { exact: false }).first()).toBeVisible({ timeout: 5_000 });
    await analystContext.close();

    const ganjamContext = await browser.newContext();
    const ganjamPage = await ganjamContext.newPage();
    await ganjamPage.goto("/login");
    await ganjamPage.getByLabel("Email").fill("officer.ganjam@punarvas.gov.in");
    await ganjamPage.getByLabel("Password").fill("PunarVas@DevDefault123");
    await ganjamPage.getByRole("button", { name: "Sign in" }).click();
    await expect(ganjamPage).toHaveURL(/\/dashboard/);

    const ganjamBell = ganjamPage.getByRole("button", { name: /Notifications/ });
    await expect(ganjamBell).toBeVisible();
    // No cross-district leakage: the Ganjam officer was not a recipient
    // of a Wayanad decision, so the aria-label must not mention "unread".
    const ganjamLabel = await ganjamBell.getAttribute("aria-label");
    expect(ganjamLabel).not.toMatch(/unread/);
    await ganjamContext.close();
  });
});
