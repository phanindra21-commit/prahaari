import { test, expect } from "@playwright/test";

/**
 * Demo-rehearsal Part 2 ("zone segregation only works via the worklist"):
 * exhaustive comparison of the direct-map-click path against the
 * priority-worklist path (same session, fresh independent sessions, stress
 * runs) never reproduced a difference in the zones GeoJSON itself — see
 * MapView.tsx's styleLoadedRef doc comment, which already covers the one
 * confirmed mechanism that could cause exactly this class of symptom (the
 * zones effect used the identical racy `isStyleLoaded()` pattern the
 * habitations effect was fixed for).
 *
 * While investigating, found a second, real, related bug: `useDistrictStore`
 * is a plain in-memory Zustand singleton with no per-session reset. Signing
 * out and back in as a *different* district-scoped user, in the same
 * browser tab (no full page reload), left `selectedDistrictId` holding the
 * previous user's district — which that previous user was scoped to, but
 * the new one may not be, so the map's zones/habitations queries could
 * silently 403 or (worse) succeed against a still-cached prior response.
 * Fixed in authStore.clearSession() (resets districtStore) and TopBar's
 * auto-select effect (re-validates the current selection against the
 * freshly fetched district list every time it changes, not just once).
 */
test.describe("district selection does not leak across sessions (requires the dev backend stack running)", () => {
  test.skip(
    !process.env.PUNARVAS_E2E_BACKEND,
    "Set PUNARVAS_E2E_BACKEND=1 when mongo+api+ml are running locally to include this test.",
  );

  test("switching users in the same tab shows the new user's district, not the previous one's", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("officer.wayanad@punarvas.gov.in");
    await page.getByLabel("Password").fill("PunarVas@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("link", { name: "Map" }).click();
    await expect(page).toHaveURL(/\/map/);
    await expect(page.locator("header select")).toContainText("Wayanad");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Email").fill("officer.ganjam@punarvas.gov.in");
    await page.getByLabel("Password").fill("PunarVas@DevDefault123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("link", { name: "Map" }).click();
    await expect(page).toHaveURL(/\/map/);
    // The regression: without the fix, this select kept showing "Wayanad,
    // Kerala" (the previous user's stale selectedDistrictId) even though
    // the signed-in officer is scoped to Ganjam and cannot act on Wayanad.
    await expect(page.locator("header select")).toContainText("Ganjam");
    await expect(page.locator("header select")).not.toContainText("Wayanad");
  });
});
