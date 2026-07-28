import { test, expect, type Locator, type Page } from "@playwright/test"

// Reuse the facility session written by tests/visual/auth.setup.ts. This
// used to build its own context and authenticate with
// `context.request.post("/api/auth/sign-in/email")`; that works (a
// context's APIRequestContext shares the cookie jar) but it burns one of
// the ten sign-ins better-auth allows per minute and it is the exact
// pattern auth.setup.ts warns about. The saved state costs nothing.
test.use({ storageState: "tests/visual/.auth/state.json" })

/**
 * Charles bug fixes — one pass over the surfaces he reported regressions on.
 *
 * 2026-07-28: re-synced with the shipped UI. The visual project could not
 * load for months (a Prisma 7 `import.meta` error in
 * smoke-cache-components.test.ts killed collection for the whole project),
 * so these assertions drifted unnoticed:
 *
 *   - The dashboard's 6-card KPI grid became a hero banner: no more
 *     `[data-slot="card"]` around "Active Contracts", and the "Recent
 *     Contracts" card is gone (the hero headline carries the count now).
 *   - The COG page's first /Import|Upload/ button is now "Mass Upload",
 *     which opens a different dialog than the COG importer this assertion
 *     is about — it has to name the "Import" button exactly.
 *   - Case Costing's page title is a hero eyebrow, not a heading element.
 *   - The prospective hub moved inside the Analysis shell's "Evaluate
 *     Proposals" tab, and its "Pricing Analysis" tab is now just
 *     "Pricing" — no longer disabled, because pricing-file analysis no
 *     longer requires a scored proposal first.
 *   - The contract-detail Delete button is icon-only; its accessible name
 *     is "Delete contract".
 */

/**
 * The portal's content region — PortalShell's `SidebarInset`, rendered by
 * components/ui/sidebar.tsx as `<main data-slot="sidebar-inset">`. The
 * sidebar sits OUTSIDE it, so rooting here keeps a hero-stat lookup off the
 * nav items (lib/constants.ts `facilityNav`), whose labels are plain text
 * and come first in the DOM. Matches facility-pages.test.ts /
 * vendor-pages.test.ts.
 */
function portalContent(page: Page): Locator {
  return page.locator('[data-slot="sidebar-inset"]')
}

/** A HeroStat renders <p>label</p><p>value</p><p>sublabel</p>. */
function heroStatValue(page: Page, label: string): Locator {
  return portalContent(page)
    .getByText(label, { exact: true })
    .first()
    .locator("xpath=following-sibling::p[1]")
}

test.describe("Charles bug fixes", () => {
  test("all fixes work end-to-end", async ({ page }) => {
    // ── Bug 1: Dashboard contracts showing ─────────────────────
    await page.goto("/dashboard")
    await expect(
      portalContent(page).getByText("Active Contracts", { exact: true }),
    ).toBeVisible({ timeout: 15_000 })
    // The hero headline is the "contracts are showing" signal the old
    // "Recent Contracts" card used to provide.
    await expect(
      page.getByRole("heading", { name: /tracked across \d+ contracts?/i }),
    ).toBeVisible({ timeout: 15_000 })
    const activeContractsStat = heroStatValue(page, "Active Contracts")
    // Pin the shape too — HeroStat renders a <Skeleton> instead of the
    // value <p> while loading, in which case this sibling lookup would
    // silently read the sublabel ("of N total") instead.
    await expect(activeContractsStat).toHaveText(/^[\d,]+$/, {
      timeout: 15_000,
    })
    const activeContracts = Number(
      (await activeContractsStat.innerText()).replace(/[^\d]/g, ""),
    )
    expect(activeContracts).toBeGreaterThan(0)
    console.log(`[PASS] Dashboard shows ${activeContracts} active contracts`)

    // ── Bug 4: COG import dialog width ─────────────────────────
    await page.goto("/dashboard/cog-data")
    // Exact name: "Mass Upload" also matches /Import|Upload/ and comes
    // first in the DOM, so a loose match measured the wrong dialog.
    const importBtn = page.getByRole("button", { name: "Import", exact: true })
    await expect(importBtn).toBeVisible({ timeout: 15_000 })
    await importBtn.click()
    const dialog = page.getByRole("dialog").first()
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    const box = await dialog.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(700)
    console.log(`[PASS] COG import dialog width: ${box?.width}px`)
    await page.keyboard.press("Escape")

    // ── Bug 3: Case Costing upload entry point ─────────────────
    await page.goto("/dashboard/case-costing")
    // "Case Costing" is the hero eyebrow (a <div>), not a heading — the
    // hero's only heading is the dynamic "N cases costed · …" line.
    await expect(
      page.getByRole("heading", { name: /\d+ cases? costed/i }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole("button", { name: /Upload Data/i }),
    ).toBeVisible({ timeout: 15_000 })

    // ── Bug 6: Evaluate Vendor Proposals ───────────────────────
    await page.goto("/dashboard/analysis/prospective")
    await page
      .getByRole("tab", { name: "Evaluate Proposals", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: "Evaluate Vendor Proposals" }),
    ).toBeVisible({ timeout: 20_000 })
    // The pricing analyzer used to be gated behind a scored proposal
    // (the tab carried data-disabled). It is now a standalone surface:
    // enabled from the start, and clicking it reveals the uploader.
    const pricingTab = page.getByRole("tab", { name: "Pricing", exact: true })
    await expect(pricingTab).toBeVisible()
    await expect(pricingTab).not.toHaveAttribute("data-disabled", /.*/)
    await pricingTab.click()
    await expect(
      page.getByText(/Upload pricing file/i).first(),
    ).toBeVisible({ timeout: 15_000 })
    console.log("[PASS] Pricing analysis tab is reachable without a proposal")

    // ── Bug 5: Contracts new page vendor list ──────────────────
    await page.goto("/dashboard/contracts/new")
    await expect(page.getByText("New Contract").first()).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole("tab", { name: /Manual Entry/i }).click()
    await expect(page.getByText("Basic Information").first()).toBeVisible({
      timeout: 15_000,
    })
    console.log("[PASS] New contract Manual Entry tab loads")

    // ── Bug 8: Contract detail Delete + Documents ──────────────
    await page.goto("/dashboard/contracts")
    const firstContractLink = page
      .locator("table tbody tr")
      .first()
      .getByRole("link")
      .first()
    await expect(firstContractLink).toBeVisible({ timeout: 20_000 })
    await firstContractLink.click()
    await page.waitForURL(/\/dashboard\/contracts\/[^/]+$/, { timeout: 20_000 })
    // Icon-only destructive button — aria-label, not a text node.
    await expect(
      page.getByRole("button", { name: "Delete contract", exact: true }),
    ).toBeVisible({ timeout: 15_000 })
    console.log("[PASS] Contract detail shows Delete button")
    await page.getByRole("tab", { name: "Documents", exact: true }).click()
    await expect(
      page.getByRole("tabpanel").getByText("Documents").first(),
    ).toBeVisible({ timeout: 15_000 })
    console.log("[PASS] Contract documents tab loads")
  })
})
