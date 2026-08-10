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

test("empty state prompts an upload when the vendor has no payor data", async ({
  page,
}) => {
  await openDividendTab(page)

  // No built-in sample any more — a vendor with no uploads sees a prompt, and
  // the model still runs on the proforma's own case volume.
  const emptyPrompt = page.getByText(/upload payor volume data to select/i)
  const picker = page.getByText(/no payor data yet/i)
  // Either the vendor genuinely has none (both visible) or a prior test's
  // upload survives; only assert the no-data branch when it applies.
  if (await picker.isVisible().catch(() => false)) {
    await expect(emptyPrompt).toBeVisible()
    await expect(page.getByText("Payor-Reported Volume")).toHaveCount(0)
  }
  // The verdict banner renders either way — the tab is usable without data.
  await expect(
    page.getByText(/this purchase (increases|reduces) the dividend/i),
  ).toBeVisible()
})

test("uploaded payor data drives the volume, Medicare rate, and the model", async ({
  page,
}) => {
  await openDividendTab(page)

  // ── Upload a real payor volume file through the dialog ──
  await page.getByRole("button", { name: /upload payor data/i }).click()
  await page.getByRole("button", { name: /unconnected facility/i }).click()
  const facilityName = `E2E Payor Facility ${Date.now()}`
  await page
    .getByPlaceholder("e.g. Coastal Surgery Center")
    .fill(facilityName)
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/e2e/fixtures/payor-volume.csv")
  await page.getByRole("button", { name: /save payor data/i }).click()

  // The route parsed it server-side and the dataset is now selected: 3 groups,
  // 880 annualized cases (knee 500 + hip 270 + shoulder 110 — trailing four
  // quarters each). Asserted on the durable summary line rather than the
  // success toast, which auto-dismisses.
  await expect(
    page.getByText(/3 groups · 880 cases\/yr/),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/2025-Q2, 2025-Q3, 2025-Q4, 2026-Q1/)).toBeVisible()
  await expect(page.getByText(/payor-volume\.csv/)).toBeVisible()

  // ── Select two groups; volume and reimbursement must come from the file ──
  await page.getByRole("button", { name: "Total Knee Replacement", exact: true }).click()
  await page.getByRole("button", { name: "Total Hip Replacement", exact: true }).click()

  // Affected cases = knee 500 + hip 270 = 770, derived not typed.
  await expect(page.getByText("2 selected · 770 cases/yr")).toBeVisible()
  await expect(
    page.getByText("Derived from the selected payor groups"),
  ).toBeVisible()

  // Quarterly volumes render straight from the uploaded rows.
  await expect(page.getByText("Payor-Reported Volume")).toBeVisible()
  await expect(
    page.getByLabel("Total Knee Replacement 2026 Q1 case volume"),
  ).toHaveValue("140")

  // Medicare basis: volume-weighted blend of CPT 27447 ($9,450 × 500) and
  // CPT 27130 ($9,641 × 270) = $9,516.97 → displayed rounded to $9,517,
  // and facility reimbursement at the 120% default = $11,420.
  await expect(page.getByText("(volume-weighted blend)")).toBeVisible()
  await expect(page.getByLabel("Medicare rate ($/case)")).toHaveValue("9517")
  await expect(page.getByText("$11,420")).toBeVisible()

  // ── Editing a quarter flows through to the model ──
  await page
    .getByLabel("Total Knee Replacement 2026 Q1 case volume")
    .fill("240")
  // Knee trailing-four becomes 110+120+130+240 = 600 → total 870.
  await expect(page.getByText("2 selected · 870 cases/yr")).toBeVisible()
  await expect(page.getByText(/\+100 cases\/yr vs\. the payor baseline/)).toBeVisible()
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
