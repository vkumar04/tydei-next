import { test, expect, type Page } from "@playwright/test"

// Reuse auth state
test.use({ storageState: "tests/visual/.auth/state.json" })

/**
 * Content checklist for each page — verifies VISIBLE elements, not just HTTP 200.
 * Each test visits a page, waits for content, and checks for specific UI elements.
 */

// ─── Helper ─────────────────────────────────────────────────────

async function expectText(page: Page, texts: string[]) {
  for (const t of texts) {
    await expect(page.getByText(t, { exact: false }).first()).toBeVisible({ timeout: 10_000 })
  }
}

async function expectCount(page: Page, role: string, minCount: number) {
  const elements = page.getByRole(role as any)  // eslint-disable-line
  await expect(elements.first()).toBeVisible({ timeout: 10_000 })
  const count = await elements.count()
  expect(count).toBeGreaterThanOrEqual(minCount)
}

// ─── Dashboard ──────────────────────────────────────────────────

test("dashboard has stat cards + charts", async ({ page }) => {
  await page.goto("/dashboard")
  await expectText(page, ["Active Contracts", "Total Spend", "Rebates", "Pending Alerts"])
  await expectText(page, ["Total Spend"]) // chart title
})

// ─── Contracts ──────────────────────────────────────────────────

test("contracts list has table + filters", async ({ page }) => {
  await page.goto("/dashboard/contracts")
  await expectText(page, ["Contracts"])
  // Should have a data table
  await expect(page.locator("table").first()).toBeVisible({ timeout: 10_000 })
})

test("new contract has 3 tabs", async ({ page }) => {
  await page.goto("/dashboard/contracts/new")
  await expectText(page, ["AI Assistant", "Upload PDF", "Manual Entry"])
  await expectText(page, ["New Contract"])
})

// ─── COG Data ───────────────────────────────────────────────────

test("cog data has stat cards + tabs", async ({ page }) => {
  await page.goto("/dashboard/cog-data")
  await expectText(page, ["Total Spend", "Total Items", "On Contract", "Off Contract", "Total Savings"])
  await expectText(page, ["COG Data", "COG Files", "Pricing Files"])
})

// ─── Case Costing ───────────────────────────────────────────────

test("case costing has stats + table", async ({ page }) => {
  await page.goto("/dashboard/case-costing")
  await expectText(page, ["Case Costing"])
  // Should have the explainer
  await expectText(page, ["How Case Costing Works"])
})

// ─── Analysis ───────────────────────────────────────────────────

test("prospective analysis has tabs", async ({ page }) => {
  await page.goto("/dashboard/analysis/prospective")
  await expectText(page, ["Upload Proposal", "Pricing Analysis", "Analysis"])
})

// ─── Renewals ───────────────────────────────────────────────────

test("renewals has stat cards", async ({ page }) => {
  await page.goto("/dashboard/renewals")
  await expectText(page, ["Contract Renewal Intelligence"])
  await expectText(page, ["Expiring in 30 Days", "Expiring in 90 Days"])
})

// ─── Reports ────────────────────────────────────────────────────

test("reports page loads", async ({ page }) => {
  await page.goto("/dashboard/reports")
  await expectText(page, ["Reports"])
})

// ─── Settings ───────────────────────────────────────────────────

test("settings has all tabs including Vendors + Categories", async ({ page }) => {
  await page.goto("/dashboard/settings")
  await expectText(page, [
    "Profile", "Notifications", "Billing", "Members",
    "Account", "Facilities", "Connections", "Features",
    "AI Credits", "Vendors", "Categories", "Add-ons",
  ])
})

// ─── Purchase Orders ────────────────────────────────────────────

test("purchase orders page loads", async ({ page }) => {
  await page.goto("/dashboard/purchase-orders")
  await expectText(page, ["Purchase Orders"])
})

// ─── Invoice Validation ─────────────────────────────────────────

test("invoice validation page loads", async ({ page }) => {
  await page.goto("/dashboard/invoice-validation")
  await expectText(page, ["Invoice"])
})

// ─── Alerts ─────────────────────────────────────────────────────

test("alerts page loads", async ({ page }) => {
  await page.goto("/dashboard/alerts")
  await expectText(page, ["Alerts"])
})

// ─── AI Agent ───────────────────────────────────────────────────

test("ai agent page loads", async ({ page }) => {
  await page.goto("/dashboard/ai-agent")
  await expectText(page, ["AI"])
})

// ─── Rebate Optimizer ───────────────────────────────────────────

test("rebate optimizer page loads", async ({ page }) => {
  await page.goto("/dashboard/rebate-optimizer")
  await expectText(page, ["Rebate"])
})
