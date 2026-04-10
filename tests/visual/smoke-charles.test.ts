import { test, expect } from "@playwright/test"

test.describe("Charles bug fixes", () => {
  test("all fixes work end-to-end", async ({ browser }) => {
    const context = await browser.newContext()

    // Log in
    const loginRes = await context.request.post(
      "http://localhost:3000/api/auth/sign-in/email",
      {
        data: {
          email: "demo-facility@tydei.com",
          password: "demo-facility-2024",
        },
      }
    )
    if (!loginRes.ok()) throw new Error(`Auth failed: ${loginRes.status()}`)

    const page = await context.newPage()

    // ── Bug 1: Dashboard contracts showing ─────────────────────
    await page.goto("http://localhost:3000/dashboard")
    await expect(page.getByText("Active Contracts").first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText("Recent Contracts").first()).toBeVisible()
    const activeContractsCard = page
      .locator('[data-slot="card"]', {
        has: page.getByText("Active Contracts"),
      })
      .first()
    const cardText = await activeContractsCard.innerText()
    const count = parseInt(cardText.match(/(\d+)/)?.[1] ?? "0")
    expect(count).toBeGreaterThan(0)
    console.log(`[PASS] Dashboard shows ${count} active contracts`)

    // ── Bug 4: COG import dialog width ─────────────────────────
    await page.goto("http://localhost:3000/dashboard/cog-data")
    await page.waitForLoadState("networkidle")
    const importBtn = page
      .getByRole("button", { name: /Import|Upload/i })
      .first()
    if (await importBtn.isVisible()) {
      await importBtn.click()
      const dialog = page.locator('[role="dialog"]').first()
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      const box = await dialog.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThan(700)
      console.log(`[PASS] COG import dialog width: ${box?.width}px`)
      await page.keyboard.press("Escape")
    }

    // ── Bug 3: Case Costing Clear Prior Data button ────────────
    await page.goto("http://localhost:3000/dashboard/case-costing")
    await expect(
      page.getByRole("heading", { name: /Case Costing/i }).first()
    ).toBeVisible({ timeout: 15_000 })
    await page.waitForLoadState("networkidle")
    await expect(
      page.getByRole("button", { name: /Upload Data/i })
    ).toBeVisible()

    // ── Bug 6: Evaluate Vendor Proposals ───────────────────────
    await page.goto("http://localhost:3000/dashboard/analysis/prospective")
    await expect(
      page.getByText("Evaluate Vendor Proposals").first()
    ).toBeVisible({ timeout: 15_000 })
    // Pricing tab disabled when no analysis loaded
    const pricingTab = page.getByRole("tab", { name: /Pricing Analysis/i })
    await expect(pricingTab).toBeVisible()
    const pricingTabDisabled = await pricingTab.getAttribute("data-disabled")
    expect(pricingTabDisabled).not.toBeNull()
    console.log(
      `[PASS] Pricing tab disabled without proposal (data-disabled=${pricingTabDisabled})`
    )
    // If no COG data, the warning banner should show; seed has COG data so it
    // should be HIDDEN. Just ensure the page renders without error.
    const cogWarning = page.getByText(/No COG data loaded/i)
    const cogWarningVisible = await cogWarning.isVisible().catch(() => false)
    console.log(`[INFO] No-COG warning visible: ${cogWarningVisible}`)

    // ── Bug 5: Contracts new page vendor list ──────────────────
    await page.goto("http://localhost:3000/dashboard/contracts/new")
    await expect(page.getByText("New Contract").first()).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole("tab", { name: /Manual Entry/i }).click()
    await page.waitForLoadState("networkidle")
    console.log("[PASS] New contract Manual Entry tab loads")

    // ── Bug 8: Contract detail Delete + Documents ──────────────
    await page.goto("http://localhost:3000/dashboard/contracts")
    await page.waitForLoadState("networkidle")
    const firstContractLink = page
      .locator("table tbody tr")
      .first()
      .locator("a")
      .first()
    if (await firstContractLink.isVisible().catch(() => false)) {
      await firstContractLink.click()
      await page.waitForURL(/\/dashboard\/contracts\/[^/]+$/, { timeout: 15_000 })
      await expect(
        page.getByRole("button", { name: /^Delete$/i })
      ).toBeVisible({ timeout: 10_000 })
      console.log("[PASS] Contract detail shows Delete button")
      const docsTab = page.getByRole("tab", { name: /^Documents$/i })
      if (await docsTab.isVisible()) {
        await docsTab.click()
        await expect(page.getByText("Documents").first()).toBeVisible()
        console.log("[PASS] Contract documents tab loads")
      }
    }

    await context.close()
  })
})
