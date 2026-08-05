import { test, expect } from "@playwright/test"

/**
 * E2E: Current State Analysis — data-scope controls (2026-08-05).
 *
 * The vendor-spend figure is scoped by a date range and a category
 * selection, and always reports an average monthly spend:
 *   1. default view shows "avg $X/mo" on the Current Vendor Spend card
 *   2. switching the range re-models and labels the annualization
 *   3. a user-added category appears in the Category Spend & ASP table
 */
test.use({ storageState: "tests/e2e/.auth/facility.json" })

test("vendor spend shows avg/mo and honors range + added categories", async ({
  page,
}) => {
  await page.goto("/dashboard/analysis/prospective")
  await expect(
    page.getByRole("heading", { name: "Current State Analysis" }),
  ).toBeVisible({ timeout: 15_000 })

  // 1. Default: the spend card reports the monthly average.
  await expect(page.getByText(/avg .*\/mo/i).first()).toBeVisible({
    timeout: 15_000,
  })

  // 2. Range switch → the card explains the annualization of the window.
  await page.getByRole("combobox").filter({ hasText: "Last 12 months" }).click()
  await page.getByRole("option", { name: "Last 3 months" }).click()
  await expect(page.getByText(/Annualized from/i).first()).toBeVisible({
    timeout: 15_000,
  })

  // 3. Add a category → it lands in the Category Spend & ASP table as a
  //    zero-spend planning row (canonicalized: lowercase, sorted tokens).
  await page.getByRole("button", { name: /categor/i }).first().click()
  await page.getByPlaceholder("Add category…").fill("Zz Planning Row")
  await page.getByPlaceholder("Add category…").press("Enter")
  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("cell", { name: "planning row zz" }).first(),
  ).toBeVisible({ timeout: 15_000 })
})
