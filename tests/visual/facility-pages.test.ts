import { test, expect, type Locator, type Page } from "@playwright/test"

// Reuse auth state
test.use({ storageState: "tests/visual/.auth/state.json" })

/**
 * Content checklist for each facility page — verifies VISIBLE elements, not
 * just HTTP 200. Each test visits a page and checks for specific UI.
 *
 * 2026-07-28: re-synced with the shipped UI. The visual project could not
 * load for months (a Prisma 7 `import.meta` error in
 * smoke-cache-components.test.ts killed collection for the whole project),
 * so these assertions drifted unnoticed. Notable drift fixed here:
 *
 *   - COG hero: "Total Items" → "Total Records", "On Contract" →
 *     "On-Contract"; "Off Contract" / "Total Savings" were dropped (the
 *     off-contract count now rides along as the Total Records sublabel).
 *   - /dashboard/analysis/prospective now renders the two-surface Analysis
 *     shell (Current State | Evaluate Proposals); the Upload / Manual /
 *     Proposals / Pricing / Compare strip lives INSIDE the second tab.
 *   - Renewals heading: "Contract Renewal Intelligence" → "Contract Renewals".
 *   - Settings gained "Facility Access" + "Alerts" and dropped "Add-ons".
 *
 * Prefer role-based locators (tab / heading / button). The hero stat labels
 * have no role, so they are matched as exact text, rooted at the portal's
 * content region (see `portalContent`) rather than at `page`.
 */

// ─── Helpers ────────────────────────────────────────────────────

/**
 * The portal's content region — PortalShell's `SidebarInset`, which
 * components/ui/sidebar.tsx renders as `<main data-slot="sidebar-inset">`.
 * It holds the top bar plus the page body; the sidebar sits OUTSIDE it.
 *
 * Every hero-stat lookup roots here, never at `page`. 2026-07-28 review:
 * `exact: true` was chosen to stop a substring match on a hero label from
 * resolving to a sidebar nav item — but it does nothing when the hero label
 * IS a nav label. `facilityNav` (lib/constants.ts) renders `<span>Contracts
 * </span>`, and the sidebar precedes the content in DOM order, so
 * `page.getByText("Contracts", { exact: true }).first()` resolved to the nav
 * link on EVERY facility route. That made the /dashboard/reports hero
 * assertion below vacuous: it passed on any page in the portal, hero or no
 * hero. Rooting at the content region is the fix for the shape, not just for
 * that one label.
 */
function portalContent(page: Page): Locator {
  return page.locator('[data-slot="sidebar-inset"]')
}

async function expectText(page: Page, texts: string[]): Promise<void> {
  for (const t of texts) {
    await expect(page.getByText(t, { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    })
  }
}

/** Hero stat labels render as plain <p>, so match their exact text. */
async function expectHeroStats(page: Page, labels: string[]): Promise<void> {
  const content = portalContent(page)
  for (const label of labels) {
    await expect(content.getByText(label, { exact: true }).first()).toBeVisible(
      { timeout: 15_000 },
    )
  }
}

/**
 * A tab name is a string when the trigger's accessible name is fixed, and a
 * RegExp when it carries a live count. Playwright ignores `exact` for a
 * RegExp, so the two cases build different options.
 */
async function expectTabs(page: Page, names: (string | RegExp)[]): Promise<void> {
  for (const name of names) {
    const tab =
      typeof name === "string"
        ? page.getByRole("tab", { name, exact: true })
        : page.getByRole("tab", { name })
    await expect(tab.first()).toBeVisible({ timeout: 15_000 })
  }
}

/** A HeroStat renders <p>label</p><p>value</p><p>sublabel</p>. */
function heroStatValue(page: Page, label: string): Locator {
  return portalContent(page)
    .getByText(label, { exact: true })
    .first()
    .locator("xpath=following-sibling::p[1]")
}

// ─── Dashboard ──────────────────────────────────────────────────

test("dashboard has stat cards + charts", async ({ page }) => {
  await page.goto("/dashboard")
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 15_000,
  })
  await expectHeroStats(page, [
    "Active Contracts",
    "Total Spend",
    "Rebates",
    "Pending Alerts",
  ])
  await expectTabs(page, ["Overview", "Spend", "Alerts"])
  await expectText(page, ["Monthly Spend & Rebate", "Contract Lifecycle"])
})

// ─── Contracts ──────────────────────────────────────────────────

test("contracts list has table + filters", async ({ page }) => {
  await page.goto("/dashboard/contracts")
  await expect(page.getByRole("heading", { name: "Contracts" })).toBeVisible({
    timeout: 15_000,
  })
  await expectTabs(page, [
    "All Contracts",
    // contracts-list-client.tsx appends a count Badge to this trigger when
    // `awaitingReviewCount > 0`, which makes the accessible name "Pending
    // Approval 2" and an exact match miss. Every other counted tab in this
    // file is already regex-matched (/^All \(\d+\)$/, /^Flagged Variances
    // \(\d+\)$/, /^Proposals \(\d+\)$/); this was the one that wasn't. The
    // dev seed happens to park all three pending contracts on OTHER
    // facilities, so it only bites after a reseed.
    /^Pending Approval( \d+)?$/,
    "Compare",
  ])
  await expect(page.locator("table").first()).toBeVisible({ timeout: 15_000 })
})

test("new contract has 3 entry-mode tabs", async ({ page }) => {
  await page.goto("/dashboard/contracts/new")
  await expectTabs(page, ["AI Assistant", "Upload PDF", "Manual Entry"])
  await expectText(page, ["New Contract"])
})

// ─── COG Data ───────────────────────────────────────────────────

test("cog data has stat cards + tabs", async ({ page }) => {
  await page.goto("/dashboard/cog-data")
  await expectHeroStats(page, [
    "Total Spend",
    "On-Contract",
    "Total Records",
    "Data Range",
  ])
  await expectTabs(page, [
    "COG Data",
    "COG Files",
    "Pricing Files",
    "Pricing List",
  ])
})

// ─── Case Costing ───────────────────────────────────────────────

test("case costing has stats + tabs + explainer", async ({ page }) => {
  await page.goto("/dashboard/case-costing")
  await expectHeroStats(page, [
    "Total Cases",
    "Avg Cost / Case",
    "Avg Margin",
    "On-Contract Rate",
  ])
  await expectTabs(page, [
    "Cases",
    "Surgeons",
    "Financial",
    "Compliance",
    "Payor Contracts",
  ])
  await expectText(page, ["How Case Costing Works"])
  await expect(
    page.getByRole("button", { name: /Upload Data/i }),
  ).toBeVisible({ timeout: 15_000 })
})

// ─── Analysis ───────────────────────────────────────────────────

test("analysis page has both surfaces, and the proposal tab strip", async ({
  page,
}) => {
  await page.goto("/dashboard/analysis/prospective")

  // Outer shell: the CFO dashboard and the proposal hub.
  await expectTabs(page, ["Current State", "Evaluate Proposals"])
  await expect(
    page.getByRole("heading", { name: "Current State Analysis" }),
  ).toBeVisible({ timeout: 15_000 })

  // The prospective hub is nested inside the second tab.
  await page.getByRole("tab", { name: "Evaluate Proposals", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Evaluate Vendor Proposals" }),
  ).toBeVisible({ timeout: 20_000 })
  await expectTabs(page, ["Upload", "Manual", "Pricing", "Compare"])
  // "Proposals (N)" carries a live count.
  await expect(
    page.getByRole("tab", { name: /^Proposals \(\d+\)$/ }),
  ).toBeVisible({ timeout: 15_000 })
})

// ─── Renewals ───────────────────────────────────────────────────

test("renewals has heading + the four expiry buckets", async ({ page }) => {
  await page.goto("/dashboard/renewals")
  await expect(
    page.getByRole("heading", { name: "Contract Renewals" }),
  ).toBeVisible({ timeout: 15_000 })
  await expectHeroStats(page, [
    "Expiring in 30 Days",
    "Expiring in 60 Days",
    "Expiring in 90 Days",
    "At-Risk",
  ])
})

/**
 * (b) REAL BUG — NOT a stale assertion. Left failing on purpose.
 *
 * components/facility/renewals/renewals-client.tsx:123 hands the hero
 * `totalContracts: rows.length`, where `rows` comes from
 * `useExpiringContracts(facilityId, 365, "facility")` — i.e. only the
 * contracts expiring within the next 365 days. That window-scoped number is
 * then presented as the whole portfolio on THREE surfaces, all fed from the
 * same wrong value:
 *
 *   1. renewals-hero.tsx:81  headline  "No contracts on file yet."
 *                            (or "All {totalContracts} contracts are more
 *                             than 90 days from expiration.")
 *   2. renewals-hero.tsx:69  status pill "No contracts"
 *   3. renewals-client.tsx:188  `rows.length === 0` → EmptyState titled
 *                            "No contracts on file"
 *
 * Verified against the dev seed today: Lighthouse Surgical Center has 7
 * contracts, all expiring 2028-07-01, so 0 fall inside the 365-day window.
 * /dashboard/contracts says "7 contracts · This facility" and the dashboard
 * hero says "tracked across 7 contracts", while /dashboard/renewals says
 * "No contracts on file yet."
 *
 * THE FIX IS TWO-PART; both halves are required for this test to go green:
 *   (a) feed the hero a portfolio-wide `totalContracts` (e.g. from
 *       getContractStats, which lib/actions/__tests__/
 *       get-contract-stats-hero-scope.test.ts already pins as a true
 *       portfolio aggregate) and keep `rows.length` for the buckets. This
 *       fixes 1 and 2 at once — same prop.
 *   (b) re-word the list empty-state so it describes the WINDOW, not the
 *       portfolio — e.g. "No contracts expiring in the next 365 days", the
 *       way the vendor page's empty card already does. Doing only (a)
 *       leaves the page still telling a 7-contract facility it has none.
 *       The assertions below are written to accept that wording.
 *
 * The fix belongs in renewals-client.tsx / renewals-hero.tsx, not here.
 * Same `totalContracts` defect on the vendor side — see vendor-pages.test.ts
 * (its empty-state copy is already window-scoped, so it is a one-part fix).
 *
 * The assertion cross-checks the two surfaces instead of hard-coding 7, so
 * it stays honest across reseeds. When the fix lands this test starts
 * FIXED 2026-07-28: the hero now reads a portfolio-wide total, so the `.fail`
 * marker is gone and this guards the fix.
 */
test(
  "renewals headline describes the whole portfolio, not the 365-day window",
  async ({ page }) => {
    await page.goto("/dashboard/contracts")
    // HeroStat swaps the value <p> for a <Skeleton> while the query is in
    // flight, which would make the sibling lookup below read the sublabel.
    // Wait for a real number first.
    const totalContractsStat = heroStatValue(page, "Total Contracts")
    await expect(totalContractsStat).toHaveText(/^[\d,]+$/, {
      timeout: 20_000,
    })
    const portfolioTotal = (await totalContractsStat.innerText()).trim()
    expect(Number(portfolioTotal.replace(/,/g, ""))).toBeGreaterThan(0)

    await page.goto("/dashboard/renewals")
    await expect(
      page.getByRole("heading", { name: "Contract Renewals" }),
    ).toBeVisible({ timeout: 15_000 })
    // Wait out the loading skeleton — the hero only mounts once the
    // expiring-contracts query settles.
    await expect(
      page.getByText("Expiring in 30 Days", { exact: true }),
    ).toBeVisible({ timeout: 20_000 })

    // No surface on this page may claim the facility HAS NO CONTRACTS.
    // Three renderings of the same window-scoped number say exactly that:
    // the hero headline ("No contracts on file yet."), the list empty-state
    // ("No contracts on file"), and the hero status pill (exactly "No
    // contracts").
    //
    // Both patterns are deliberately narrow, so a correct fix can still say
    // the WINDOW is empty: "No contracts expiring in the next 365 days"
    // matches neither, and neither does "No renewals match your filters"
    // (renewals-list.tsx). Do not widen these to /^No contracts/ — that
    // would make the honest window-scoped wording fail too.
    await expect(page.getByText(/^No contracts on file/)).toHaveCount(0)
    await expect(page.getByText("No contracts", { exact: true })).toHaveCount(0)

    const headline = await page
      .getByText(
        /(No contracts on file yet\.|All \d+ contracts are more than 90 days from expiration\.|\d+ contracts? expire in the next 90 days\.)/,
      )
      .first()
      .innerText()
    const claimed = headline.match(/All (\d+) contracts/)?.[1] ?? null
    expect(
      claimed,
      `renewals hero headline was "${headline}" — it should name all ${portfolioTotal} contracts`,
    ).toBe(portfolioTotal)
  },
)

// ─── Reports ────────────────────────────────────────────────────

test("reports page has the contract-type report tabs", async ({ page }) => {
  await page.goto("/dashboard/reports")
  await expectHeroStats(page, ["Contracts", "Vendors", "Active Schedules"])
  await expectTabs(page, [
    "Overview",
    "Usage",
    "Capital",
    "Service",
    "Tie-In",
    "Grouped",
    "Pricing",
    "By Rebate Type",
    "Calculations",
  ])
})

// ─── Settings ───────────────────────────────────────────────────

test("settings has all tabs including Vendors + Categories", async ({
  page,
}) => {
  await page.goto("/dashboard/settings")
  await expectTabs(page, [
    "Profile",
    "Notifications",
    "Billing",
    "Members",
    "Facility Access",
    "Alerts",
    "Account",
    "Facilities",
    "Connections",
    "Vendors",
    "Categories",
    "Features",
    "AI Credits",
  ])
})

// ─── Purchase Orders ────────────────────────────────────────────

test("purchase orders page has stats + status tabs", async ({ page }) => {
  await page.goto("/dashboard/purchase-orders")
  await expectHeroStats(page, [
    "Total POs",
    "On-Contract Spend",
    "Off-Contract Spend",
    "Pending Approval",
  ])
  await expect(
    page.getByRole("tab", { name: /^All \(\d+\)$/ }),
  ).toBeVisible({ timeout: 15_000 })
})

// ─── Invoice Validation ─────────────────────────────────────────

test("invoice validation page has stats + review tabs", async ({ page }) => {
  await page.goto("/dashboard/invoice-validation")
  await expectHeroStats(page, [
    "Total Invoices",
    "Awaiting Review",
    "Flagged Variance",
    "Recovered",
  ])
  await expect(
    page.getByRole("tab", { name: /^Flagged Variances \(\d+\)$/ }),
  ).toBeVisible({ timeout: 15_000 })
})

// ─── Alerts ─────────────────────────────────────────────────────

test("alerts page has the four alert buckets", async ({ page }) => {
  await page.goto("/dashboard/alerts")
  await expectHeroStats(page, [
    "Off-Contract",
    "Expiring",
    "Rebates Due",
    "Total Unresolved",
  ])
})

// ─── AI Agent ───────────────────────────────────────────────────

test("ai agent page loads with its chat tabs", async ({ page }) => {
  await page.goto("/dashboard/ai-agent")
  await expect(
    page.getByRole("heading", { name: "AI Assistant" }).first(),
  ).toBeVisible({ timeout: 15_000 })
  await expectTabs(page, ["Chat", "Documents", "Reports"])
})

// ─── Rebate Optimizer ───────────────────────────────────────────

test("rebate optimizer page loads with its analysis tabs", async ({ page }) => {
  await page.goto("/dashboard/rebate-optimizer")
  await expect(
    page.getByRole("heading", { name: "Spend Rebate Tier Optimizer" }),
  ).toBeVisible({ timeout: 15_000 })
  await expectTabs(page, [
    "Contracts",
    "Earnings",
    "Scenarios",
    "Opportunities",
    "Sensitivity",
  ])
})
