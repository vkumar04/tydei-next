import { test, expect, type Page } from "@playwright/test"

test.use({ storageState: "tests/visual/.auth/state.json" })

/**
 * Contract detail + new-contract content checklist.
 *
 * 2026-07-28: re-synced with the shipped UI. The visual project could not
 * load for months (a Prisma 7 `import.meta` error in
 * smoke-cache-components.test.ts killed collection for the whole project),
 * so every assertion in here drifted unnoticed against a moving UI. What
 * changed, and why each assertion below looks the way it does:
 *
 *   - The contracts table's first <td> is the row-selection checkbox, whose
 *     onClick stops propagation. Clicking it selects a row instead of
 *     navigating. The contract-name cell is an <a> — click that.
 *   - The tab strip grew a "Pricing" tab (6 tabs, not 5).
 *   - The header actions are Edit Contract / Add Amendment / Export /
 *     Delete (icon-only, aria-label "Delete contract"). "AI Score" and
 *     "Extract Amendment" no longer exist anywhere in the codebase.
 *   - /dashboard/contracts/new defaults to the Upload PDF entry mode, not
 *     AI Assistant (deliberate — new-contract-client.tsx "Bug #20").
 *
 * Locators are role-based wherever the DOM offers a role, so the next copy
 * tweak surfaces as a real failure rather than silent rot.
 */

/** The contract-detail tab strip, in DOM order. */
const CONTRACT_TABS = [
  "Overview",
  "Transactions",
  "Performance",
  "Rebates & Tiers",
  "Pricing",
  "Documents",
] as const

/** Header action buttons. "Delete contract" is icon-only — aria-label. */
const CONTRACT_ACTIONS = [
  "Edit Contract",
  "Add Amendment",
  "Export",
  "Delete contract",
] as const

async function expectText(page: Page, texts: string[]): Promise<void> {
  for (const t of texts) {
    await expect(page.getByText(t, { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    })
  }
}

async function openFirstContract(page: Page): Promise<void> {
  await page.goto("/dashboard/contracts")
  const firstContractLink = page
    .locator("table tbody tr")
    .first()
    .getByRole("link")
    .first()
  await expect(firstContractLink).toBeVisible({ timeout: 20_000 })
  await firstContractLink.click()
  await page.waitForURL(/\/dashboard\/contracts\/[^/]+$/, { timeout: 20_000 })
}

test("contract detail has stat cards + the full tab strip", async ({ page }) => {
  await openFirstContract(page)

  // Stat cards. "Current Spend" renders as "Current Spend (Last 12 Months)".
  await expectText(page, [
    "Contract Value",
    "Current Spend",
    "Rebates Earned",
    "Days Until Expiration",
  ])

  // Tabs — assert the count too, so a tab being added or dropped fails here
  // instead of quietly passing because the ones we name still exist.
  const tabStrip = page.getByRole("tablist").first()
  await expect(tabStrip.getByRole("tab")).toHaveCount(CONTRACT_TABS.length)
  for (const name of CONTRACT_TABS) {
    await expect(tabStrip.getByRole("tab", { name, exact: true })).toBeVisible()
  }

  // Overview is the default tab and owns the Contract Details card.
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("data-state", "active")
  await expectText(page, ["Contract Details", "Contract Type"])

  // Header actions.
  for (const name of CONTRACT_ACTIONS) {
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeVisible()
  }

  // Transactions — the card title differs between the empty state
  // ("Transaction Ledger") and the populated one ("Contract
  // Transactions"). Either proves the panel rendered.
  await page.getByRole("tab", { name: "Transactions", exact: true }).click()
  const emptyLedger = page.getByText("Transaction Ledger")
  const populatedLedger = page.getByText("Contract Transactions")
  await expect(emptyLedger.or(populatedLedger).first()).toBeVisible({
    timeout: 20_000,
  })

  // Rebates & Tiers — the terms card renders in both the "no terms
  // defined" and populated states.
  await page.getByRole("tab", { name: "Rebates & Tiers", exact: true }).click()
  await expect(page.getByText("Terms & Tiers").first()).toBeVisible({
    timeout: 15_000,
  })

  // Documents.
  await page.getByRole("tab", { name: "Documents", exact: true }).click()
  await expect(
    page.getByRole("tabpanel").getByText("Documents").first(),
  ).toBeVisible({ timeout: 15_000 })
})

test("new contract — Upload PDF is the default entry mode", async ({ page }) => {
  await page.goto("/dashboard/contracts/new")

  // new-contract-client.tsx "Bug #20" (2026-05-11): PDF is the primary
  // intake path, so it is the default. This spec asserted AI Assistant for
  // over a year after that shipped.
  await expect(page.getByRole("tab", { name: /Upload PDF/i })).toHaveAttribute(
    "data-state",
    "active",
  )
  await expect(
    page.getByRole("tab", { name: /AI Assistant/i }),
  ).toHaveAttribute("data-state", "inactive")

  // The AI tab still owns the extraction entry point.
  await page.getByRole("tab", { name: /AI Assistant/i }).click()
  await expect(
    page.getByRole("button", { name: /Start AI Extraction/i }),
  ).toBeVisible({ timeout: 10_000 })
})

test("new contract — Upload PDF tab has pricing + document sections", async ({
  page,
}) => {
  await page.goto("/dashboard/contracts/new")
  await page.getByRole("tab", { name: /Upload PDF/i }).click()

  await expectText(page, [
    "Upload Contract PDF",
    "Upload Pricing File",
    "Additional Documents",
  ])
})

test("new contract — Manual Entry has all form sections", async ({ page }) => {
  await page.goto("/dashboard/contracts/new")
  await page.getByRole("tab", { name: /Manual Entry/i }).click()

  await expectText(page, [
    "Basic Information",
    "Contract Dates",
    "Financial Details",
    "Contract Terms",
  ])

  // Sticky action bar. "Cancel" is a <Button asChild><Link> — it renders
  // as an <a>, so it is a link, not a button.
  for (const name of ["Create Contract", "Save as Draft"]) {
    await expect(
      page.getByRole("button", { name, exact: true }).first(),
    ).toBeVisible({ timeout: 10_000 })
  }
  await expect(
    page.getByRole("link", { name: "Cancel", exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 })
  await expectText(page, ["Pricing File"])
})
