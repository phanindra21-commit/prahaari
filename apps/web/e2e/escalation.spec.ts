import { test, expect } from "@playwright/test";

/**
 * STATE_ADMIN can approve/modify/reject/defer ANY in-state recommendation
 * now, not only an escalated one (a deliberate product decision — see
 * docs/SECURITY.md §4 for the reasoning and the mitigation: mandatory
 * justification, hash-chained audit log, distinct decisionLevel/severity
 * marking). Escalation (§4.1) remains in place as a routing/visibility
 * signal a District Officer can still raise, no longer as a gate on the
 * State Admin's approval right.
 *
 * Uses Chamoli (Deepika Bhandari, District Officer) / Uttarakhand (Harish
 * Rawat, State Admin) rather than Wayanad/Kerala deliberately: every other
 * standing e2e spec logs in as officer.wayanad@ at least once, and that
 * account's login-rate-limit budget (5 attempts/15min, apps/api's
 * loginRateLimiter) is already fully spent by the rest of the suite in one
 * run — adding a sixth use here would reproduce exactly the suite-
 * reliability bug fixed for worklist-filters.spec.ts in the Step
 * 10-continued session (switched to analyst.wayanad@ for the same reason).
 * Chamoli/Uttarakhand sidesteps the shared budget entirely. The exact
 * scenario this exercises (a State Admin deciding an ordinary Wayanad
 * recommendation, a cross-state attempt still blocked) was also verified
 * once, live, as the specifically-named Priya Nair / Ravi Varma accounts —
 * see the session notes; this standing spec targets a different pilot
 * district only to keep the suite's login budget independent, not because
 * the feature behaves differently there.
 */
test.describe("STATE_ADMIN approves any in-state recommendation (requires the dev backend stack running)", () => {
  test.skip(
    !process.env.PRAHARI_E2E_BACKEND,
    "Set PRAHARI_E2E_BACKEND=1 when mongo+api+ml are running locally, seeded, with a completed Chamoli/Ganjam pipeline run.",
  );

  test("State Admin decides an ORDINARY, non-escalated recommendation directly; District Officer's escalation still works as a routing signal; cross-state stays blocked", async ({
    page,
  }) => {
    // --- Deepika Bhandari (Chamoli District Officer) escalates one recommendation, as a routing signal ---
    await page.goto("/login");
    await page.getByLabel("Email").fill("officer.chamoli@prahari.gov.in");
    await page.getByLabel("Password").fill("PRAHARI@DevDefault123");
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
        "Escalating to State: flagging this recommendation for state-level visibility — verified via Playwright e2e run.",
      );
    await page.getByRole("button", { name: /Submit Escalate to State/ }).click();
    await expect(page.getByText("Decision recorded.")).toBeVisible({ timeout: 10_000 });

    // A second, ordinary (non-escalated) Chamoli recommendation — the headline case.
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
    await page.getByLabel("Email").fill("stateadmin.uttarakhand@prahari.gov.in");
    await page.getByLabel("Password").fill("PRAHARI@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Full decision controls on the ORDINARY, non-escalated recommendation — no "Approval restricted".
    await page.goto(ordinaryUrl);
    await expect(page.getByText("Record a decision")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Approval restricted")).toHaveCount(0);
    // No escalate option for a State Admin — that stays a district-officer action.
    await expect(page.getByRole("button", { name: "Escalate to State" })).toHaveCount(0);

    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page
      .getByPlaceholder(/Explain the basis for this decision/)
      .fill(
        "State-level approval of an ordinary, non-escalated recommendation after reviewing suitability and capacity — verified via Playwright e2e run.",
      );
    await page.getByRole("button", { name: /Submit Approve/ }).click();
    await expect(page.getByText("Decision recorded.")).toBeVisible({ timeout: 10_000 });

    // Audit trail: state-level marking, and the chain still verifies. Exact
    // match — the justification text above also contains the (differently
    // cased) substring "State-level", which getByText's default
    // case-insensitive substring match would otherwise also pick up.
    await expect(page.getByText("STATE-LEVEL", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Chain verified")).toBeVisible({ timeout: 10_000 });

    // The one Deepika Bhandari escalated: still unlocked too, still shows the escalation context.
    await page.goto(escalatedUrl);
    await expect(page.getByText(/^Escalated to State/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Record a decision")).toBeVisible();
  });

  test("SECURITY: a cross-state attempt is still blocked — a Kerala State Admin cannot open a real Ganjam recommendation", async ({
    page,
    request,
  }) => {
    // Resolve a real, current Ganjam (Odisha) recommendation id via the API
    // directly (as SUPER_ADMIN) rather than hardcoding one — recommendation
    // ids are regenerated by every pipeline run, so a hardcoded id would go
    // stale. The API runs on a separate origin/port from the web preview
    // server this suite's baseURL points at, so these use absolute URLs.
    const API_BASE_URL = "http://localhost:4000/api/v1";
    const login = await request.post(`${API_BASE_URL}/auth/login`, {
      data: { email: "superadmin@prahari.gov.in", password: "PRAHARI@DevDefault123" },
    });
    const { accessToken } = (await login.json()) as { accessToken: string };
    const districts = await request.get(`${API_BASE_URL}/districts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const { items: districtItems } = (await districts.json()) as { items: Array<{ _id: string; name: string }> };
    const ganjam = districtItems.find((d) => d.name === "Ganjam");
    if (!ganjam) throw new Error("Ganjam district not found — is the database seeded?");
    const recs = await request.get(`${API_BASE_URL}/recommendations?districtId=${ganjam._id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const { items: recItems } = (await recs.json()) as { items: Array<{ _id: string }> };
    if (recItems.length === 0) throw new Error("No Ganjam recommendations found — has the Ganjam pipeline run?");
    const ganjamRecommendationId = recItems[0]!._id;

    await page.goto("/login");
    await page.getByLabel("Email").fill("stateadmin.kerala@prahari.gov.in");
    await page.getByLabel("Password").fill("PRAHARI@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto(`/recommendations/${ganjamRecommendationId}`);
    await expect(page.getByText(/Could not load this recommendation/)).toBeVisible({ timeout: 10_000 });
  });
});
