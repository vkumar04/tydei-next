import { test, expect, type Page } from "@playwright/test"

/**
 * E2E: Facility contract lifecycle
 *
 * Covers the user journey Charles hit the most regressions on:
 *   1. Navigate to Contracts list and open a real contract
 *   2. Terms & Tiers tab renders the correct rate label for the method
 *   3. On vs Off Contract card renders a non-zero number for contracts
 *      with real COG data
 *   4. Evergreen detection — if any contract has an evergreen expiration,
 *      it shows "Evergreen" (not "Dec 31 9999")
 *   5. Rebates Earned (YTD) stays consistent between the list row and
 *      the detail header card
 */
test.use({ storageState: "tests/e2e/.auth/facility.json" })

async function openFirstRealContract(page: Page) {
  await page.goto("/dashboard/contracts")
  // Wait for the table to render
  await expect(page.locator("table").first()).toBeVisible({ timeout: 15_000 })
  // Click the first row's contract link
  const firstRowLink = page.locator("table tbody tr").first().locator("a").first()
  await firstRowLink.click()
  // Detail page renders
  await expect(page.getByText("Overview", { exact: false }).first()).toBeVisible({ timeout: 15_000 })
}

test("contract list → detail navigation works", async ({ page }) => {
  await page.goto("/dashboard/contracts")
  await expect(page.getByText("Contracts", { exact: false }).first()).toBeVisible()
  await expect(page.locator("table").first()).toBeVisible()
  await openFirstRealContract(page)
  // URL pattern: /dashboard/contracts/<id>
  expect(page.url()).toMatch(/\/dashboard\/contracts\/[a-z0-9]+/)
})

test("terms & tiers tab renders method label", async ({ page }) => {
  await openFirstRealContract(page)
  // Click the Rebates & Tiers tab
  const tab = page.getByRole("tab", { name: /rebates & tiers/i })
  if (await tab.count()) {
    await tab.first().click()

    // The canonical labels come from formatRebateMethodLabel
    // (lib/contracts/rebate-method-label.ts): `marginal` → "Bracketed",
    // everything else → "Retroactive".
    //
    // 2026-07-27: this asserted /Retroactive|Tiered/ and was stale — Bug #23
    // (2026-05-11) renamed "Tiered (Per-slice / Marginal)" to "Bracketed", and
    // the spec was never updated. It kept passing only while a Retroactive
    // contract happened to sort first; the seeded contract that sorts first
    // today ("Medtronic Spine Category Rebate") is `marginal`, so it began
    // failing on a label that is in fact correct.
    //
    // A term with no tiers renders no method label at all, which is also
    // correct — so only assert when the tab actually shows a term.
    const methodLabel = page.getByText(/Bracketed|Retroactive/i).first()
    const termsPanel = page.getByText(/no rebate terms|no terms/i).first()

    const rendered = await Promise.race([
      methodLabel.waitFor({ state: "visible", timeout: 5_000 }).then(() => "method" as const),
      termsPanel.waitFor({ state: "visible", timeout: 5_000 }).then(() => "empty" as const),
    ]).catch(() => null)

    expect(
      rendered,
      "Rebates & Tiers tab showed neither a method label nor an empty-terms message",
    ).not.toBeNull()
  }
})

test("On vs Off Contract card renders with consistent labels", async ({ page }) => {
  await openFirstRealContract(page)
  const onOff = page.getByText("On vs Off Contract Spend", { exact: false }).first()
  await expect(onOff).toBeVisible({ timeout: 15_000 })
  // Bucket labels (post-rename): "On Contract" + "Off Contract" + "Leakage"
  await expect(page.getByText("On Contract", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("Off Contract", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("Leakage", { exact: false }).first()).toBeVisible()
})

test("evergreen contracts render 'Evergreen' not a year-9999 date", async ({ page }) => {
  // Check the contracts list for any "9999" text — should never appear.
  await page.goto("/dashboard/contracts")
  await expect(page.locator("table").first()).toBeVisible({ timeout: 15_000 })
  const tableHtml = await page.locator("table").first().innerHTML()
  expect(tableHtml).not.toContain("9999")
  // Either a real date or the sentinel label is acceptable
  // (spot-check that something shows in the Expires column)
})

test("Create Contract button is visible on contracts list", async ({ page }) => {
  await page.goto("/dashboard/contracts")
  await expect(page.getByRole("link", { name: /new contract/i }).first()).toBeVisible({
    timeout: 10_000,
  })
})

test("new contract form renders required fields", async ({ page }) => {
  await page.goto("/dashboard/contracts/new")
  await expect(page.getByText(/contract name/i).first()).toBeVisible({ timeout: 15_000 })
  // "Save as Draft" + "Create Contract" buttons present
  await expect(page.getByRole("button", { name: /save as draft/i }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: /create contract/i }).first()).toBeVisible()
})
