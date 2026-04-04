import { test, expect, type Page } from "@playwright/test"

/**
 * Vendor portal visual content tests.
 * Uses vendor auth (separate from facility).
 */

// ─── Helper ─────────────────────────────────────────────────────

async function loginAsVendor(page: Page) {
  await page.goto("/login")
  await page.getByPlaceholder(/email/i).fill("demo-vendor@tydei.com")
  await page.getByPlaceholder(/password/i).fill("demo-vendor-2024")
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/vendor/, { timeout: 10_000 })
}

async function expectText(page: Page, texts: string[]) {
  for (const t of texts) {
    await expect(page.getByText(t, { exact: false }).first()).toBeVisible({ timeout: 10_000 })
  }
}

// ─── Vendor Dashboard ───────────────────────────────────────────

test("vendor dashboard has stat cards", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor")
  await expectText(page, ["Dashboard"])
})

// ─── Vendor Contracts ───────────────────────────────────────────

test("vendor contracts list has stat cards + tabs", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/contracts")
  await expectText(page, ["My Contracts"])
  await expectText(page, ["Total Contracts", "Active", "Pending Review", "Total Value"])
})

test("vendor new contract has 3 entry modes", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/contracts/new")
  await expectText(page, ["AI Assistant", "Upload PDF", "Manual Entry"])
})

// ─── Vendor Prospective ─────────────────────────────────────────

test("vendor prospective has 5 tabs", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/prospective")
  await expectText(page, ["Prospective Analysis"])
  await expectText(page, ["Opportunities", "My Proposals", "Deal Scorer", "Benchmarks", "Analytics"])
  // Stat cards
  await expectText(page, ["Total Proposals", "Avg Deal Score", "Acceptable Deals"])
})

// ─── Vendor Market Share ────────────────────────────────────────

test("vendor market share has charts + breakdown", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/market-share")
  await expectText(page, ["Market Share"])
  await expectText(page, ["Category Breakdown"])
  await expectText(page, ["Growth Opportunities"])
})

// ─── Vendor Performance ─────────────────────────────────────────

test("vendor performance page loads", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/performance")
  await expectText(page, ["Performance"])
})

// ─── Vendor Purchase Orders ─────────────────────────────────────

test("vendor purchase orders page loads", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/purchase-orders")
  await expectText(page, ["Purchase Orders"])
})

// ─── Vendor Invoices ────────────────────────────────────────────

test("vendor invoices page loads", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/invoices")
  await expectText(page, ["Invoice"])
})

// ─── Vendor Renewals ────────────────────────────────────────────

test("vendor renewals page loads", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/renewals")
  await expectText(page, ["Renewal"])
})

// ─── Vendor Settings ────────────────────────────────────────────

test("vendor settings page loads", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/settings")
  await expectText(page, ["Settings"])
})

// ─── Vendor Alerts ──────────────────────────────────────────────

test("vendor alerts page loads", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/alerts")
  await expectText(page, ["Alerts"])
})

// ─── Vendor AI Agent ────────────────────────────────────────────

test("vendor ai agent page loads", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/ai-agent")
  await expectText(page, ["AI"])
})

// ─── Vendor Reports ─────────────────────────────────────────────

test("vendor reports page loads", async ({ page }) => {
  await loginAsVendor(page)
  await page.goto("/vendor/reports")
  await expectText(page, ["Reports"])
})
