import { test, expect } from "@playwright/test"

/**
 * E2E: the DCF Analysis tab on a vendor contract (Charles 2026-08-13) — link a
 * saved Dividend/DCF proposal to a contract and see how THAT contract's rebate
 * ladder feeds the projected owner dividend, with a prospective usage lever.
 */
test.use({ storageState: "tests/e2e/.auth/vendor.json" })

test("contract detail exposes a DCF Analysis tab", async ({ page }) => {
  await page.goto("/vendor/contracts")
  const firstContract = page.getByRole("link", { name: /view|detail/i }).first()
  const rows = page.locator("tbody tr")
  if ((await rows.count()) === 0) test.skip(true, "no contracts seeded")

  // Open the first contract however the list links to it.
  if (await firstContract.isVisible().catch(() => false)) {
    await firstContract.click()
  } else {
    await rows.first().click()
  }
  await page.waitForURL(/\/vendor\/contracts\/[^/]+$/, { timeout: 15_000 })

  const dcfTab = page.getByRole("tab", { name: /dcf analysis/i })
  await expect(dcfTab).toBeVisible({ timeout: 15_000 })
  await dcfTab.click()

  await expect(
    page.getByText(/DCF proposals linked to this contract/i),
  ).toBeVisible()
  // With nothing linked yet the tab explains itself rather than rendering blank.
  await expect(
    page.getByText(/No DCF proposals linked yet|Usage growth assumption/),
  ).toBeVisible()
  // The link affordance is always present.
  await expect(page.getByRole("button", { name: /link a proposal/i })).toBeVisible()
})
