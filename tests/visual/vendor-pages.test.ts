import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test"

/**
 * Vendor portal visual content tests.
 * Uses vendor auth (separate from facility).
 *
 * 2026-07-28: re-synced with the shipped UI after the visual project spent
 * months unable to load (a Prisma 7 `import.meta` error in
 * smoke-cache-components.test.ts killed collection for the whole project).
 * Two classes of change:
 *
 *  1. Copy drift — the contracts hero's third stat is "Facilities Served",
 *     not "Pending Review"; the prospective hero's third stat is "Avg Deal
 *     Score" with "Projected Annual Spend" beside it ("Acceptable Deals"
 *     is gone). Assertions are now role-based or exact-text so the next
 *     rename fails loudly instead of matching some unrelated body copy.
 *
 *  2. Self-inflicted rate limiting — every test used to run a full browser
 *     login. better-auth caps /sign-in/email at 10 per 60s per IP
 *     (lib/auth-server.ts `rateLimit.customRules`), so the back half of
 *     this file reliably 429'd and failed in `waitForURL`. One login per
 *     worker now; the rest replay its cookies.
 */

// ─── Auth (one real login per worker) ───────────────────────────

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>

let vendorCookies: Cookies | null = null

async function loginAsVendor(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  if (vendorCookies) {
    await context.addCookies(vendorCookies)
    return
  }
  await page.goto("/login")
  // 2026-07-27: was getByPlaceholder(/email/i), which never matched — the
  // placeholder is "you@example.com". The <Label> is the stable selector.
  await page.getByLabel(/^email$/i).fill("demo-vendor@tydei.com")
  await page.getByLabel(/^password$/i).fill("demo-vendor-2024")
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/vendor/, { timeout: 15_000 })
  vendorCookies = await context.cookies()
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * The portal's content region — PortalShell's `SidebarInset`, rendered by
 * components/ui/sidebar.tsx as `<main data-slot="sidebar-inset">`. The
 * sidebar sits OUTSIDE it.
 *
 * Hero-stat lookups root here, never at `page`. `exact: true` stops a hero
 * label from matching a LONGER sidebar label, but not from matching an
 * identical one — `vendorNav` (lib/constants.ts) has no exact collision with
 * the labels below today, but `facilityNav` does ("Contracts"), and that
 * silently hollowed out an assertion in facility-pages.test.ts. Same helper
 * shape here so the vendor file can't grow the same hole when a hero label
 * or a nav label is renamed.
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

async function expectTabs(page: Page, names: string[]): Promise<void> {
  for (const name of names) {
    await expect(
      page.getByRole("tab", { name, exact: true }).first(),
    ).toBeVisible({ timeout: 15_000 })
  }
}

/** A HeroStat renders <p>label</p><p>value</p><p>sublabel</p>. */
function heroStatValue(page: Page, label: string): Locator {
  return portalContent(page)
    .getByText(label, { exact: true })
    .first()
    .locator("xpath=following-sibling::p[1]")
}

// ─── Vendor Dashboard ───────────────────────────────────────────

test("vendor dashboard has stat cards", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor")
  await expect(
    page.getByRole("heading", { name: "Vendor Dashboard" }),
  ).toBeVisible({ timeout: 15_000 })
  await expectHeroStats(page, [
    "Active Contracts",
    "Active Facilities",
    "Sales (Trailing 12 Mo)",
    "Rebates Paid",
  ])
  await expectTabs(page, ["Overview", "Performance", "Contracts"])
})

// ─── Vendor Contracts ───────────────────────────────────────────

test("vendor contracts list has stat cards + tabs", async ({
  page,
  context,
}) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/contracts")
  await expect(
    page.getByRole("heading", { name: "My Contracts" }),
  ).toBeVisible({ timeout: 15_000 })
  await expectHeroStats(page, [
    "Total Contracts",
    "Active",
    "Facilities Served",
    "Total Value",
  ])
  await expectTabs(page, [
    "All",
    "Draft",
    "Submitted",
    "Pending",
    "Active",
    "Rejected",
  ])
})

test("vendor new contract has 3 entry modes", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/contracts/new")
  await expectTabs(page, ["AI Assistant", "Upload PDF", "Manual Entry"])
})

// ─── Vendor Prospective ─────────────────────────────────────────

test("vendor prospective has 3 tabs", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/prospective")
  await expectText(page, ["Prospective Analysis"])
  // Assert on the tabs themselves, not any visible text — the previous
  // expectText list had gone stale ("My Proposals" / "Deal Scorer" were
  // folded into "Proposals" long before Analytics was removed) and still
  // passed, because those words appear in body copy elsewhere on the page.
  await expectTabs(page, ["Opportunities", "Proposals", "Benchmarks"])
  await expect(page.getByRole("tab", { name: "Analytics" })).toHaveCount(0)
  // Stat cards. "Acceptable Deals" was folded into the Avg Deal Score
  // sublabel ("N rated accept or better") — it is no longer a stat.
  await expectHeroStats(page, [
    "Total Proposals",
    "Projected Annual Spend",
    "Avg Deal Score",
  ])
})

// ─── Vendor Market Share ────────────────────────────────────────

test("vendor market share has charts + breakdown", async ({
  page,
  context,
}) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/market-share")
  await expect(
    page.getByRole("heading", { name: "Market Share Analysis" }),
  ).toBeVisible({ timeout: 15_000 })
  await expectTabs(page, ["Overview", "By Category", "By Facility", "Competitors"])
  await expectText(page, ["Category Breakdown", "Growth Opportunities"])
})

// ─── Vendor Performance ─────────────────────────────────────────

test("vendor performance page loads", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/performance")
  await expectHeroStats(page, [
    "Total Spend",
    "Rebates Paid",
    "Avg Compliance",
    "Active Contracts",
  ])
  await expectTabs(page, [
    "Overview",
    "By Contract",
    "Rebate Progress",
    "By Category",
  ])
})

// ─── Vendor Purchase Orders ─────────────────────────────────────

test("vendor purchase orders page loads", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/purchase-orders")
  await expect(
    page.getByRole("heading", { name: "Purchase Orders" }),
  ).toBeVisible({ timeout: 15_000 })
  await expectHeroStats(page, [
    "Total POs",
    "Total Value",
    "Pending Approval",
    "Fulfillment Rate",
  ])
})

// ─── Vendor Invoices ────────────────────────────────────────────

test("vendor invoices page loads", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/invoices")
  // `exact` matters: the hero headline is also a heading and reads
  // "No invoices submitted yet." while the query is in flight, which a
  // substring match on "Invoices" would resolve to as well.
  await expect(
    page.getByRole("heading", { name: "Invoices", exact: true }),
  ).toBeVisible({ timeout: 15_000 })
  await expectHeroStats(page, [
    "Total Invoiced",
    "Paid",
    "Outstanding",
    "Disputed",
  ])
})

// ─── Vendor Renewals ────────────────────────────────────────────

test("vendor renewals page loads", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/renewals")
  await expect(
    page.getByRole("heading", { name: "Contract Renewals" }),
  ).toBeVisible({ timeout: 15_000 })
  // Seed dependency, stated so a reseed failure is diagnosable rather than
  // mysterious: vendor-renewals-client.tsx short-circuits to a "No Expiring
  // Contracts" card — no hero, no stats — when the 365-day window is empty.
  // Stryker has one contract inside it (Surgical Navigation Pricing,
  // 2027-07-01), and a contract only moves TOWARD the window as time passes,
  // so this branch is stable for this seed. If the four assertions below
  // ever fail together, check the window before touching the labels.
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
 * The vendor twin of the facility renewals defect pinned in
 * facility-pages.test.ts. components/vendor/renewals/vendor-renewals-client.tsx:145
 * hands VendorRenewalsHero `totalContracts: contracts.length`, where
 * `contracts` comes from `useExpiringContracts(vendorId, 365, "vendor")` —
 * only the contracts expiring within the next 365 days. The hero then
 * prints that window-scoped number as the portfolio total:
 *
 *   "All {totalContracts} contracts are more than 90 days from expiration."
 *
 * Verified against the dev seed today: Stryker has 5 contracts, 1 of them
 * expiring inside 365 days. /vendor/contracts says "5 contracts · 2
 * facilities served" and its hero's Total Contracts tile reads 5, while
 * /vendor/renewals says "All 1 contracts are more than 90 days from
 * expiration."
 *
 * Unlike the facility twin this is a ONE-PART fix, which is why this test
 * asserts one surface where facility-pages.test.ts asserts three. The only
 * consumer of the bad number here is the hero (headline + status pill, both
 * off the same `totalContracts` prop); the page's empty branch —
 * vendor-renewals-client.tsx:170, "No Expiring Contracts" / "No contracts
 * are expiring within the next year" — already names its window, so it is
 * NOT part of the defect and must not be re-worded. Feeding the hero a
 * portfolio-wide count — `getVendorContracts().portfolio.contractCount`
 * (lib/actions/vendor-contracts.ts:173, a server-side `_count.id` over the
 * whole portfolio), the same aggregate /vendor/contracts already uses —
 * turns this test green on its own.
 *
 * The baseline read below is a true portfolio total, not another page-scoped
 * number: vendor-contract-list.tsx:253 builds it from that server rollup
 * plus in-flight submissions, with a "Charles 2026-07-27" note about the
 * first-page reduction it replaced.
 *
 * This test cross-checks the two surfaces rather than hard-coding 5, so it
 * stays honest across reseeds. The fix belongs in
 * vendor-renewals-client.tsx, not here. When it lands this test starts
 * passing and Playwright will fail the run for an unexpected pass; drop
 * the `.fail` then.
 */
test.fail(
  "vendor renewals headline describes the whole portfolio, not the 365-day window",
  async ({ page, context }) => {
    await loginAsVendor(page, context)

    await page.goto("/vendor/contracts")
    // HeroStat swaps the value <p> for a <Skeleton> while the query is in
    // flight, which would make the sibling lookup below read the sublabel.
    // Wait for a real number first.
    const totalContractsStat = heroStatValue(page, "Total Contracts")
    await expect(totalContractsStat).toHaveText(/^[\d,]+$/, {
      timeout: 20_000,
    })
    const portfolioTotal = (await totalContractsStat.innerText()).trim()
    expect(Number(portfolioTotal.replace(/,/g, ""))).toBeGreaterThan(0)

    await page.goto("/vendor/renewals")
    // Wait out the loading skeleton — the hero only mounts once the
    // expiring-contracts query settles.
    await expect(
      page.getByText("Expiring in 30 Days", { exact: true }),
    ).toBeVisible({ timeout: 20_000 })

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

// ─── Vendor Settings ────────────────────────────────────────────

test("vendor settings page loads", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/settings")
  await expectText(page, ["Vendor workspace"])
  await expectTabs(page, [
    "Profile",
    "Identity",
    "Notifications",
    "Organization",
    "Divisions",
    "Connections",
    "COGS",
    "Alerts",
    "Billing",
    "AI Credits",
  ])
})

// ─── Vendor Alerts ──────────────────────────────────────────────

test("vendor alerts page loads", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/alerts")
  await expectHeroStats(page, [
    "Unresolved",
    "High Priority",
    "Medium Priority",
    "Resolved",
  ])
})

// ─── Vendor AI Agent ────────────────────────────────────────────

test("vendor ai agent page loads", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/ai-agent")
  await expect(
    page.getByRole("heading", { name: "AI Vendor Assistant" }),
  ).toBeVisible({ timeout: 15_000 })
})

// ─── Vendor Reports ─────────────────────────────────────────────

test("vendor reports page loads", async ({ page, context }) => {
  await loginAsVendor(page, context)
  await page.goto("/vendor/reports")
  await expectHeroStats(page, [
    "Generated (MTD)",
    "Scheduled",
    "Last Sent",
    "Facilities Reached",
  ])
  await expectTabs(page, ["Overview", "Usage", "Capital", "Service", "Tie-In"])
})
