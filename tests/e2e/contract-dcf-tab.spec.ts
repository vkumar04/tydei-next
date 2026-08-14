import { test, expect, type Page } from "@playwright/test"

/**
 * E2E: the DCF Analysis tab on a vendor contract (Charles 2026-08-13) — link a
 * saved Dividend/DCF proposal to a contract and see how THAT contract's rebate
 * ladder feeds the projected owner dividend, with a prospective usage lever.
 */
test.use({ storageState: "tests/e2e/.auth/vendor.json" })

/**
 * Open the first contract's DCF Analysis tab.
 *
 * Waiting correctly here is fiddlier than it looks. The DataTable renders five
 * SKELETON rows while loading, so clicking `tbody tr` too early hits a skeleton
 * and never navigates. But waiting for zero skeletons is ALSO wrong on its own:
 * that is true before the table has rendered anything at all, so the wait
 * returns instantly, the row count is 0, and the test skips itself while
 * reporting green. (Measured against production, which has 3 contracts: the
 * skeleton-only wait skipped; a 6s sleep saw rows=3.)
 *
 * So: wait for SOME row to exist first — skeleton or real, and the empty state
 * is itself a row, so this terminates either way — then wait for the skeletons
 * to clear. Only then is the row count meaningful.
 */
async function openFirstContractDcfTab(page: Page) {
  await page.goto("/vendor/contracts")
  const rows = page.locator("tbody tr")
  await expect(rows.first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('tbody [data-slot="skeleton"]')).toHaveCount(0, {
    timeout: 30_000,
  })

  const firstContract = page.getByRole("link", { name: /view|detail/i }).first()
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
}

test("contract detail exposes a DCF Analysis tab", async ({ page }) => {
  await openFirstContractDcfTab(page)

  await expect(
    page.getByText(/DCF proposals linked to this contract/i),
  ).toBeVisible()
  // With nothing linked yet the tab explains itself rather than rendering blank.
  await expect(
    page.getByText(/No DCF proposals linked yet|Growth assumption/),
  ).toBeVisible()
  // The link affordance is always present.
  await expect(page.getByRole("button", { name: /link a proposal/i })).toBeVisible()
})

test("an untouched growth slider makes the contract tab agree with the proposal", async ({
  page,
}) => {
  // The landing state is the identity case: with no override the projection
  // runs at the proposal's own cashFlowGrowthPct, so "NPV (net of capital)"
  // and the "proposal alone" sub-line are the SAME number. Before the fix the
  // tab hard-coded 5% usage growth and re-solved the P&L per year, which read
  // +$7,330 against the proposal's own -$79,724 — a sign flip.
  const name = `E2E DCF identity ${Date.now()}`

  await page.goto("/vendor/prospective")
  await page.getByRole("tab", { name: /dividend \/ dcf/i }).click()
  await page.getByRole("button", { name: /save proposal/i }).click()
  await page.getByLabel("Proposal name", { exact: true }).fill(name)
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText(`Saved “${name}”`)).toBeVisible({ timeout: 15_000 })

  await openFirstContractDcfTab(page)

  await page.getByRole("button", { name: /link a proposal/i }).click()
  await page.getByRole("button", { name: new RegExp(name, "i") }).first().click()

  // The card reports which rate it used, and it is the proposal's own.
  await expect(page.getByText(/this proposal's own rate/i)).toBeVisible({
    timeout: 15_000,
  })

  // Locate each Stat by its label and read the sibling value/sub rows, rather
  // than by Tailwind class — the child order is the stable contract here.
  const statCard = (label: string) =>
    page.getByText(label, { exact: true }).locator("..")

  const npvCard = statCard("NPV (net of capital)")
  const headline = (await npvCard.locator("> div").nth(1).textContent())?.trim()
  const sub = (await npvCard.locator("> div").nth(2).textContent())?.trim()

  const proposalAlone = sub?.match(/proposal alone (\S+)/)?.[1]
  expect(headline, "NPV headline should render").toBeTruthy()
  expect(proposalAlone, "sub-line should name the proposal's own NPV").toBeTruthy()

  const tierSub = (await statCard("Rebate tier")
    .locator("> div")
    .nth(2)
    .textContent())?.trim()

  if (tierSub === "no spend-dollar ladder") {
    // No rebate to add, so the contract is a pass-through: the two figures are
    // the SAME number. This is the assertion the fix exists for — pre-fix the
    // tab re-solved the P&L per year at a hard-coded 5% and diverged from the
    // proposal's own NPV, by enough to flip the sign.
    expect(headline).toBe(proposalAlone)
  } else {
    // With a ladder the contract can only ADD rebate uplift, so the headline is
    // never below the proposal's own NPV.
    const num = (s: string) => Number(s.replace(/[^0-9.-]/g, "")) * (s.includes("M") ? 1_000_000 : s.includes("k") ? 1_000 : 1)
    expect(num(headline!)).toBeGreaterThanOrEqual(num(proposalAlone!) - 0.01)
  }

  await page.goto("/vendor/prospective")
  await page.getByRole("tab", { name: /dividend \/ dcf/i }).click()
  await page.getByRole("button", { name: /^saved/i }).click()
  await page.getByRole("button", { name: `Delete ${name}` }).click()
  await expect(page.getByText("Proposal deleted")).toBeVisible()
})
