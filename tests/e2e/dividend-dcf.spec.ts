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
  // One locator for the whole summary line — matching the filename on its own
  // also hits the upload dialog's picked-file label while it animates closed.
  await expect(
    page.getByText(
      /3 groups · 880 cases\/yr · 2025-Q2, 2025-Q3, 2025-Q4, 2026-Q1 · payor-volume\.csv/,
    ),
  ).toBeVisible({ timeout: 15_000 })

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

test("uploaded P&L replaces the example proforma and drives the model", async ({
  page,
}) => {
  await openDividendTab(page)

  // Baseline: the 1.2x-Medicare example, NOI $12,465,463.
  await expect(page.getByText(/Using the 1.2× Medicare example/)).toBeVisible()
  await expect(page.getByText("$12,465,463").first()).toBeVisible()

  await page.getByRole("button", { name: /upload p&l/i }).click()
  await page.getByRole("button", { name: /unconnected facility/i }).click()
  const facilityName = `E2E P&L Facility ${Date.now()}`
  await page.getByPlaceholder("e.g. Coastal Surgery Center").fill(facilityName)
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/e2e/fixtures/proforma.csv")
  await page.getByRole("button", { name: "Import", exact: true }).click()

  // All 21 line items recognized, and the P&L card now cites the upload.
  await expect(
    page.getByText(new RegExp(`Loaded from the uploaded statement for ${facilityName}`)),
  ).toBeVisible({ timeout: 15_000 })

  // The before-column now reflects the uploaded statement, not the example:
  // 300,000,000 - 260,000,000 = 40,000,000 revenue; NOI 17,895,000.
  await expect(page.getByText("$40,000,000").first()).toBeVisible()
  await expect(page.getByText("$17,895,000").first()).toBeVisible()

  // Reset restores the example.
  await page.getByRole("button", { name: /reset to example/i }).click()
  await expect(page.getByText(/Using the 1.2× Medicare example/)).toBeVisible()
  await expect(page.getByText("$12,465,463").first()).toBeVisible()
})

test("uploaded Medicare rates shadow the built-in table", async ({ page }) => {
  await openDividendTab(page)

  // Ground the scenario so the Medicare card renders.
  await page.getByRole("button", { name: /upload payor data/i }).click()
  await page.getByRole("button", { name: /unconnected facility/i }).click()
  await page
    .getByPlaceholder("e.g. Coastal Surgery Center")
    .fill(`E2E Rates Facility ${Date.now()}`)
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/e2e/fixtures/payor-volume.csv")
  await page.getByRole("button", { name: /save payor data/i }).click()
  await expect(page.getByText(/3 groups · 880 cases\/yr/)).toBeVisible({
    timeout: 15_000,
  })
  await page
    .getByRole("button", { name: "Total Knee Replacement", exact: true })
    .click()

  // Built-in CY2025: $9,450.
  await expect(page.getByLabel("Medicare rate ($/case)")).toHaveValue("9450")

  // Upload a CY2026 table that raises knee to $9,750.
  const setName = `E2E CY2026 ${Date.now()}`
  await page.getByRole("button", { name: /upload rates/i }).click()
  await page.getByLabel("Rate set name").fill(setName)
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/e2e/fixtures/medicare-rates.csv")
  await page.getByRole("button", { name: "Import", exact: true }).click()

  // The uploaded set auto-applies and the rate moves.
  await expect(page.getByLabel("Medicare rate ($/case)")).toHaveValue("9750", {
    timeout: 15_000,
  })
  // Facility reimbursement follows at 120%: 9750 x 1.2 = 11,700.
  await expect(page.getByText("$11,700")).toBeVisible()

  // Switching back to the built-in restores $9,450.
  await page.getByRole("combobox").filter({ hasText: setName }).click()
  await page.getByRole("option", { name: /built-in/i }).click()
  await expect(page.getByLabel("Medicare rate ($/case)")).toHaveValue("9450")
})

test("an Excel-exported P&L with a title row imports the ANNUAL column", async ({
  page,
}) => {
  // Audit regression 2026-08-10: the CSV path rebuilt the cell matrix from
  // header NAMES. Excel pads every row to the used range, so a title row
  // yields headers ["Steady State Proforma","",""] — the two blank keys
  // collapsed and the trailing per-case column overwrote the annual column.
  // Salaries imported as $583 instead of $3,500,000, with a success toast.
  await openDividendTab(page)

  await page.getByRole("button", { name: /upload p&l/i }).click()
  await page.getByRole("button", { name: /unconnected facility/i }).click()
  await page
    .getByPlaceholder("e.g. Coastal Surgery Center")
    .fill(`E2E Excel Export ${Date.now()}`)
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/e2e/fixtures/proforma-excel-export.csv")
  await page.getByRole("button", { name: "Import", exact: true }).click()

  // Annual figures, not per-case: revenue 40,000,000 and NOI 17,895,000.
  await expect(page.getByText("$40,000,000").first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText("$17,895,000").first()).toBeVisible()
  // The per-case column must NOT have become the statement.
  await expect(page.getByText("$583").first()).toHaveCount(0)
})

test("editing an authoritative Medicare rate overrides the built-in estimate", async ({
  page,
}) => {
  // Charles 2026-08-11: "need to be able to adjust these". The built-in table
  // is an ESTIMATE; a rep must be able to enter the real allowable per group.
  await openDividendTab(page)

  // Ground the scenario so the Medicare card (and its editor) render.
  await page.getByRole("button", { name: /upload payor data/i }).click()
  await page.getByRole("button", { name: /unconnected facility/i }).click()
  await page
    .getByPlaceholder("e.g. Coastal Surgery Center")
    .fill(`E2E Rate Editor ${Date.now()}`)
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/e2e/fixtures/payor-volume.csv")
  await page.getByRole("button", { name: /save payor data/i }).click()
  await expect(page.getByText(/3 groups · 880 cases\/yr/)).toBeVisible({
    timeout: 15_000,
  })
  await page
    .getByRole("button", { name: "Total Knee Replacement", exact: true })
    .click()

  // Built-in estimate: $9,450.
  await expect(page.getByLabel("Medicare rate ($/case)")).toHaveValue("9450")

  // Open the editor and set an authoritative figure.
  await page.getByRole("button", { name: /^medicare rates/i }).click()
  await expect(
    page.getByRole("heading", { name: /authoritative medicare rates/i }),
  ).toBeVisible()
  const kneeRate = page.getByLabel("Rate per case for Total Knee Replacement")
  await expect(kneeRate).toHaveValue("9450")
  await kneeRate.fill("10200")
  await expect(page.getByText("1 unsaved")).toBeVisible()
  await page.getByRole("button", { name: /save changes/i }).click()
  await expect(page.getByText(/Saved 1 authoritative rate/)).toBeVisible({
    timeout: 15_000,
  })

  // The row is now Authoritative, and the trigger carries a count badge.
  await expect(page.getByText("Authoritative").first()).toBeVisible()
  await page.keyboard.press("Escape")

  // The blended rate on the card follows the authoritative value.
  await expect(page.getByLabel("Medicare rate ($/case)")).toHaveValue("10200")
  // Facility reimbursement at 120%: 10,200 x 1.2 = 12,240.
  await expect(page.getByText("$12,240")).toBeVisible()

  // Revert restores the built-in estimate.
  await page.getByRole("button", { name: /^medicare rates/i }).click()
  await page.getByRole("button", { name: /revert/i }).first().click()
  await expect(page.getByText(/Reverted to the underlying rate/)).toBeVisible({
    timeout: 15_000,
  })
  await page.keyboard.press("Escape")
  await expect(page.getByLabel("Medicare rate ($/case)")).toHaveValue("9450")
})

test("the rate editor filters, and filtering preserves unsaved edits", async ({
  page,
}) => {
  await openDividendTab(page)
  await page.getByRole("button", { name: /^medicare rates/i }).click()
  await expect(
    page.getByRole("heading", { name: /authoritative medicare rates/i }),
  ).toBeVisible()

  // The built-in table is 30 groups; the count line reports the full set.
  await expect(page.getByText(/^30 rows$/)).toBeVisible()

  // Edit a rate, then filter — the unsaved edit must survive, because the
  // filter narrows what is RENDERED, not what is held in the draft.
  const knee = page.getByLabel("Rate per case for Total Knee Replacement")
  await knee.fill("10200")
  await expect(page.getByText(/30 rows · 1 edited/)).toBeVisible()

  await page.getByLabel("Filter Medicare rates").fill("hip")
  await expect(page.getByText(/of 30 rows/)).toBeVisible()
  await expect(knee).toHaveCount(0) // knee is filtered out of the DOM…
  await expect(page.getByText(/· 1 edited/)).toBeVisible() // …but still dirty

  // Clearing the filter brings the row back WITH the edit intact.
  await page.getByLabel("Filter Medicare rates").fill("")
  await expect(
    page.getByLabel("Rate per case for Total Knee Replacement"),
  ).toHaveValue("10200")

  // A filter matching nothing says so rather than showing a blank table.
  await page.getByLabel("Filter Medicare rates").fill("zzzznope")
  await expect(page.getByText(/No rate matches/)).toBeVisible()
})

test("rate editor rows lay out in columns — inputs stack, nothing overflows", async ({
  page,
}) => {
  // Regression 2026-08-13 (Vick, screenshot): <input> is inline-block and
  // TableCell is whitespace-nowrap, so the name and note inputs shared one
  // line at w-full each — 200% of the cell — and bled across the CPT and Rate
  // columns, which then rendered on top of the note text.
  await openDividendTab(page)
  await page.getByRole("button", { name: /^medicare rates/i }).click()
  await expect(
    page.getByRole("heading", { name: /authoritative medicare rates/i }),
  ).toBeVisible()

  const geom = await page.evaluate(() => {
    // Scope to the DIALOG: the section behind it also renders a Table
    // (the before/after P&L), and it comes first in the DOM.
    const dialog = document.querySelector('[role="dialog"]')
    const row = dialog?.querySelector('[data-slot="table"] tbody tr')
    if (!row) return null
    const cells = [...row.querySelectorAll("td")]
    const inputs = [...cells[0].querySelectorAll("input")]
    const r = (el: Element) => el.getBoundingClientRect()
    return {
      nameCell: { x: r(cells[0]).x, right: r(cells[0]).right },
      cptCell: { x: r(cells[1]).x },
      nameInput: { y: r(inputs[0]).y, right: r(inputs[0]).right },
      noteInput: { y: r(inputs[1]).y, right: r(inputs[1]).right },
    }
  })
  expect(geom).not.toBeNull()
  const g = geom!

  // The note must sit BELOW the name, not beside it.
  expect(g.noteInput.y).toBeGreaterThan(g.nameInput.y)
  // Both must stay inside the Name column (1px tolerance for subpixel).
  expect(g.nameInput.right).toBeLessThanOrEqual(g.nameCell.right + 1)
  expect(g.noteInput.right).toBeLessThanOrEqual(g.nameCell.right + 1)
  // …and must not reach into the CPT column.
  expect(g.noteInput.right).toBeLessThanOrEqual(g.cptCell.x + 1)
})

test("a saved DCF proposal is listed on Opportunities and opens in the DCF tab", async ({
  page,
}) => {
  // Charles 2026-08-13: saved proposals belong on the Opportunities list, and
  // clicking one must show the DIVIDEND/DCF representation — not the
  // contract-proposal detail dialog, which is a different object entirely.
  const name = `E2E Opportunity DCF ${Date.now()}`
  await openDividendTab(page)
  await page.getByRole("button", { name: /save proposal/i }).click()
  await page.getByLabel("Proposal name", { exact: true }).fill(name)
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText(`Saved “${name}”`)).toBeVisible({ timeout: 15_000 })

  // It appears under its own heading on Opportunities.
  await page.getByRole("tab", { name: /opportunities/i }).click()
  await expect(page.getByText("Dividend / DCF proposals")).toBeVisible()
  const card = page.getByRole("button", {
    name: `Open ${name} in the Dividend / DCF tab`,
  })
  await expect(card).toBeVisible()

  // Clicking switches to the Dividend/DCF tab and restores the proposal…
  await card.click()
  await expect(
    page.getByRole("heading", { name: /dividend & dcf impact report/i }),
  ).toBeVisible()
  await expect(page.getByText(`Loaded “${name}”`)).toBeVisible({ timeout: 15_000 })
  // The header badge proves the scenario actually restored, not just toasted.
  await expect(page.getByText(name).first()).toBeVisible()
  // …and NOT the old contract-proposal detail dialog.
  await expect(page.getByRole("heading", { name: /proposal details/i })).toHaveCount(0)

  // Clean up.
  await page.getByRole("button", { name: /^saved/i }).click()
  await page.getByRole("button", { name: `Delete ${name}` }).click()
  await expect(page.getByText("Proposal deleted")).toBeVisible()
})
