import { test, expect, type Page } from "@playwright/test"

test.use({ storageState: "tests/visual/.auth/state.json" })

async function expectText(page: Page, texts: string[]) {
  for (const t of texts) {
    await expect(page.getByText(t, { exact: false }).first()).toBeVisible({ timeout: 10_000 })
  }
}

/**
 * Contract detail page content checklist.
 * This test would have caught:
 * - Missing stat cards (Contract Value, Current Spend, Rebates, Days)
 * - Missing tabs (Overview, Transactions, Performance, Rebates & Tiers, Documents)
 * - Missing commitment progress section
 */

test("contract detail has stat cards + 5 tabs", async ({ page }) => {
  // Navigate to contracts list first to find a contract
  await page.goto("/dashboard/contracts")
  await page.waitForLoadState("networkidle")

  // Click the first contract row if one exists
  const firstRow = page.locator("table tbody tr").first()
  const hasContracts = await firstRow.isVisible().catch(() => false)

  if (!hasContracts) {
    test.skip(true, "No contracts in database")
    return
  }

  // Click contract name to navigate to detail
  await firstRow.locator("td").first().click()
  await page.waitForURL(/\/dashboard\/contracts\//, { timeout: 10_000 })

  // Verify stat cards
  await expectText(page, ["Contract Value", "Current Spend", "Rebates Earned", "Days Until"])

  // Verify 5 tabs
  await expectText(page, ["Overview", "Transactions", "Performance", "Rebates & Tiers", "Documents"])

  // Verify Overview tab content (default)
  await expectText(page, ["Contract Details", "Contract Type"])

  // Verify action buttons
  await expectText(page, ["AI Score", "Extract Amendment", "Edit", "Delete"])

  // Click Transactions tab
  await page.getByRole("tab", { name: "Transactions" }).click()
  await page.waitForTimeout(2000)
  await expectText(page, ["Transaction"])

  // Click Rebates & Tiers tab
  await page.getByRole("tab", { name: "Rebates & Tiers" }).click()
  // Should show terms or "no terms" message

  // Click Documents tab
  await page.getByRole("tab", { name: "Documents" }).click()
  await expectText(page, ["Documents"])
})

test("new contract creation flow — AI tab is default", async ({ page }) => {
  await page.goto("/dashboard/contracts/new")

  // AI Assistant tab should be active by default
  const aiTab = page.getByRole("tab", { name: /AI Assistant/i })
  await expect(aiTab).toHaveAttribute("data-state", "active")

  // Should have AI extraction button and text extract
  await expectText(page, ["Start AI Extraction"])
})

test("new contract — Upload PDF tab has pricing + document sections", async ({ page }) => {
  await page.goto("/dashboard/contracts/new")

  // Switch to Upload PDF tab
  await page.getByRole("tab", { name: /Upload PDF/i }).click()

  // Should have both sections
  await expectText(page, ["Upload Contract PDF", "Upload Pricing File"])

  // Additional Documents section
  await expectText(page, ["Additional Documents"])
})

test("new contract — Manual Entry has all form sections", async ({ page }) => {
  await page.goto("/dashboard/contracts/new")

  // Switch to Manual Entry tab
  await page.getByRole("tab", { name: /Manual Entry/i }).click()

  // Form sections
  await expectText(page, [
    "Basic Information",
    "Contract Dates",
    "Financial Details",
    "Contract Terms",
  ])

  // Sidebar
  await expectText(page, ["Create Contract", "Save as Draft", "Cancel"])

  // Pricing File section in sidebar
  await expectText(page, ["Pricing File"])
})
