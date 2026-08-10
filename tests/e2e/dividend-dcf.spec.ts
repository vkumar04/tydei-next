import { test, expect, type Page } from "@playwright/test"

/**
 * E2E: the vendor Dividend / DCF tab (/vendor/prospective → "Dividend / DCF").
 *
 * Covers the journeys that span client state + server actions:
 *   1. The tab renders with the default scenario and an accretive verdict.
 *   2. Scenario edits flip the verdict live (client recompute).
 *   3. Selecting a sample payor procedure group grounds the affected-case
 *      baseline and reveals the Medicare reimbursement card.
 *   4. Save → reopen → delete a proposal (DividendProposal server actions +
 *      cache invalidation).
 */
test.use({ storageState: "tests/e2e/.auth/vendor.json" })

async function openDividendTab(page: Page) {
  await page.goto("/vendor/prospective")
  await page.getByRole("tab", { name: /dividend \/ dcf/i }).click()
  await expect(
    page.getByRole("heading", { name: /dividend & dcf impact report/i }),
  ).toBeVisible()
}

test("dividend tab renders the default accretive scenario", async ({ page }) => {
  await openDividendTab(page)

  // Default scenario: +$250/case on 1,200 cases + 150 incremental cases is
  // accretive (pinned in lib/financial-analysis/__tests__/proforma-pnl.test.ts).
  await expect(
    page.getByText("This purchase increases the dividend"),
  ).toBeVisible()
  await expect(page.getByText("Steady-State P&L — Before vs. After")).toBeVisible()
  await expect(page.getByText("Enterprise Value Impact")).toBeVisible()
})

test("scenario edits flip the verdict live", async ({ page }) => {
  await openDividendTab(page)

  // A pure price increase with no incremental volume reduces the dividend.
  await page.getByLabel("Incremental cases / year").fill("0")
  await page.getByLabel("Supply cost change per case").fill("500")
  await expect(
    page.getByText("This purchase reduces the dividend"),
  ).toBeVisible()

  // Savings flip it back to accretive.
  await page.getByLabel("Supply cost change per case").fill("-100")
  await expect(
    page.getByText("This purchase increases the dividend"),
  ).toBeVisible()
})

test("selecting a payor group grounds volume and shows Medicare basis", async ({
  page,
}) => {
  await openDividendTab(page)

  // The built-in sample dataset (East Coast Data) is preselected; its
  // procedure-group chips render without any upload.
  await page
    .getByRole("button", { name: "Total Knee Replacement", exact: true })
    .click()

  // Affected cases become derived from the payor-verified volume…
  await expect(
    page.getByText("Derived from the selected payor groups"),
  ).toBeVisible()
  // …the quarterly volume card appears…
  await expect(page.getByText("Payor-Reported Volume")).toBeVisible()
  // …and the Medicare card shows the group's public rate anchor (CPT 27447).
  await expect(page.getByText("CPT 27447")).toBeVisible()
})

test("save, reopen, and delete a dividend proposal", async ({ page }) => {
  const proposalName = `E2E dividend proposal ${Date.now()}`
  await openDividendTab(page)

  // Save the current scenario under a unique name.
  await page.getByRole("button", { name: /save proposal/i }).click()
  // exact: the scenario card's "Product / proposal name" input would
  // substring-match otherwise.
  await page.getByLabel("Proposal name", { exact: true }).fill(proposalName)
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText(`Saved “${proposalName}”`)).toBeVisible()

  // The header now shows the loaded-proposal badge.
  await expect(page.getByText(proposalName).first()).toBeVisible()

  // Reload → the proposal survives (DB-backed, not localStorage) and reopens.
  await page.reload()
  await page.getByRole("tab", { name: /dividend \/ dcf/i }).click()
  await page.getByRole("button", { name: /^saved/i }).click()
  await expect(page.getByText(proposalName)).toBeVisible()
  await page
    .locator("div")
    .filter({ hasText: proposalName })
    .getByRole("button", { name: "Open" })
    .first()
    .click()
  await expect(page.getByText(`Loaded “${proposalName}”`)).toBeVisible()

  // Clean up: delete it from the manage dialog.
  await page.getByRole("button", { name: /^saved/i }).click()
  await page
    .getByRole("button", { name: `Delete ${proposalName}` })
    .click()
  await expect(page.getByText("Proposal deleted")).toBeVisible()
})
