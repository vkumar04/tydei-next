import { test, expect, type Page } from "@playwright/test"

/**
 * E2E: facility portal core journeys.
 *
 * Fills the coverage hole around the facility surfaces that had no e2e
 * spec at all. Every page below was reachable from the sidebar but only
 * ever asserted by the `visual` project (which checks a couple of text
 * strings), so a payload-shape regression that renders the error
 * boundary instead of the page shipped silently more than once.
 *
 * Every test here is READ-ONLY and therefore re-runnable against the
 * same seeded database:
 *   - no rows are created, edited or deleted
 *   - the only interactions are tab switches and opening a <Select>,
 *     which are client-state and reset on the next page load
 *
 * Assertions deliberately target STRUCTURE (headings, hero-stat labels,
 * tab names, column headers, filter controls) rather than seeded dollar
 * amounts or row counts — those change on every `bun run db:seed`.
 *
 * Every block ends with `expectNoErrorShell()`. That is the assertion
 * that catches the class of bug Charles keeps hitting: the page returns
 * HTTP 200, the shell and sidebar paint, and the content area is the
 * `<ErrorBoundaryCard>` ("Something went wrong" + a digest hash) or
 * Next's own crash overlay. A test that only checks the URL passes
 * happily through all of those.
 */

// Every describe in this file drives the facility portal as
// demo-facility@tydei.com (org: "Lighthouse Surgical Center").
// tests/e2e/auth.setup.ts saved this state — never log in from a spec.
test.use({ storageState: "tests/e2e/.auth/facility.json" })

/** The demo facility this user belongs to. Matched by NAME, never by id. */
const DEMO_FACILITY = "Lighthouse Surgical Center"

/** Client-side TanStack Query fetches make first paint slower than nav. */
const LOAD = 20_000

/**
 * Page-content region.
 *
 * The portal shell nests TWO <main> elements: the vendored shadcn
 * `SidebarInset` is itself a <main>, and the page-content wrapper inside
 * it is another (components/shared/shells/portal-shell.tsx). `.last()` is
 * the inner one, so scoping through it excludes the sidebar nav — which
 * matters because nav links are named "Contracts", "Reports", "Alerts",
 * "COG Data"… exactly like several hero-stat labels and card titles.
 * If the vendored wrapper ever stops being a <main>, `.last()` still
 * resolves to the page-content main, so this stays correct either way.
 */
function content(page: Page) {
  return page.getByRole("main").last()
}

/**
 * Assert the route rendered real content, not an error shell.
 *
 *   - "Something went wrong"  → components/shared/error-boundary-card.tsx
 *     (app/dashboard/error.tsx renders it for any thrown server action)
 *   - "An error occurred"     → Next's production Server-Components
 *     render message, which the boundary echoes verbatim
 *   - "Application error"     → Next's global client-side crash overlay
 *
 * Always call this AFTER a positive content assertion. `toHaveCount(0)`
 * passes instantly on an empty page, so on its own it would go green
 * before the boundary had a chance to paint.
 */
async function expectNoErrorShell(page: Page, route: string) {
  for (const pattern of [
    /something went wrong/i,
    /an error occurred/i,
    /application error/i,
  ]) {
    await expect(
      page.getByText(pattern),
      `${route} rendered an error shell matching ${pattern}`,
    ).toHaveCount(0)
  }
}

/**
 * Assert each hero-stat label renders. HeroStat
 * (components/shared/stats/hero-stat.tsx) puts the label in its own <p>,
 * so an exact-text match hits the label and not the surrounding panel.
 * `.first()` because some labels legitimately repeat further down the
 * page (e.g. "On Contract" also appears as a table badge).
 */
async function expectHeroStats(page: Page, labels: string[]) {
  for (const label of labels) {
    await expect(
      content(page).getByText(label, { exact: true }).first(),
      `missing hero stat "${label}"`,
    ).toBeVisible({ timeout: LOAD })
  }
}

// ─── /dashboard — facility home ──────────────────────────────

test.describe("facility dashboard home", () => {
  test("hero stat cards and tabs render", async ({ page }) => {
    await page.goto("/dashboard")

    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible({ timeout: LOAD })

    // The four hero numbers (dashboard-hero.tsx). Labels, not values —
    // the seeded dollar figures move on every re-seed.
    await expectHeroStats(page, [
      "Active Contracts",
      "Total Spend",
      "Rebates",
      "Pending Alerts",
    ])

    // The hero headline is composed from the KPI payload, so its presence
    // proves getDashboardKPISummary + getContractStats both resolved
    // rather than the page falling back to a skeleton.
    await expect(
      content(page).getByText(/YTD spend tracked across/i),
    ).toBeVisible({ timeout: LOAD })

    for (const tab of ["Overview", "Spend", "Alerts"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible()
    }

    await expectNoErrorShell(page, "/dashboard")
  })

  test("Spend tab shows the spend summary strip, not a copy of Overview", async ({
    page,
  }) => {
    await page.goto("/dashboard")
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible({ timeout: LOAD })

    await page.getByRole("tab", { name: "Spend" }).click()

    // DashboardSpendSummaryStrip — four labels Overview does not carry.
    // Added precisely so the two tabs aren't near-duplicates; if a
    // refactor collapses them again these disappear.
    for (const label of [
      "On-contract spend (YTD)",
      "Off-contract spend (YTD)",
      "On-contract share",
      "Rebate yield",
    ]) {
      await expect(content(page).getByText(label, { exact: true })).toBeVisible({
        timeout: LOAD,
      })
    }

    await expectNoErrorShell(page, "/dashboard (Spend tab)")
  })
})

// ─── /dashboard/rebate-optimizer ─────────────────────────────

test.describe("rebate optimizer", () => {
  // NOTE: the vendor dropdown's *contents* are already pinned by
  // critical-flows.spec.ts ("lists multiple vendors"). This block only
  // asserts the page renders and its primary controls are present.
  test("page header, control bar and hero render", async ({ page }) => {
    await page.goto("/dashboard/rebate-optimizer")

    await expect(
      page.getByRole("heading", {
        name: "Spend Rebate Tier Optimizer",
        level: 1,
      }),
    ).toBeVisible({ timeout: LOAD })

    // Control bar: vendor filter (Label htmlFor → SelectTrigger id),
    // the live contract count, and the reports escape hatch.
    await expect(
      content(page).getByText("Vendor", { exact: true }).first(),
    ).toBeVisible()
    await expect(page.getByRole("combobox").first()).toBeVisible({
      timeout: LOAD,
    })
    await expect(
      content(page).getByText("Contracts", { exact: true }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: /rebate reports/i }),
    ).toBeVisible()

    // Hero stats render once the opportunity query settles.
    await expectHeroStats(page, [
      "Earned YTD",
      "Potential Additional",
      "Close to Next Tier",
    ])

    await expectNoErrorShell(page, "/dashboard/rebate-optimizer")
  })

  test("renders either the optimizer tabs or the explicit empty state", async ({
    page,
  }) => {
    await page.goto("/dashboard/rebate-optimizer")
    await expect(
      page.getByRole("heading", { name: "Spend Rebate Tier Optimizer" }),
    ).toBeVisible({ timeout: LOAD })

    // The tab set is data-dependent (each tab only mounts when its slice
    // is non-empty), so assert the invariant instead: the page resolves
    // to a real tablist OR the "no optimizable contracts" empty state —
    // never an indefinite skeleton.
    const tabs = page.getByRole("tab", { name: "Contracts" })
    const empty = content(page).getByText(/no optimizable contracts/i)
    await expect(tabs.or(empty).first()).toBeVisible({ timeout: LOAD })

    await expectNoErrorShell(page, "/dashboard/rebate-optimizer")
  })
})

// ─── /dashboard/renewals ─────────────────────────────────────

test.describe("renewals", () => {
  test("header, hero stats and filter controls render", async ({ page }) => {
    await page.goto("/dashboard/renewals")

    await expect(
      page.getByRole("heading", { name: "Contract Renewals", level: 1 }),
    ).toBeVisible({ timeout: LOAD })

    await expectHeroStats(page, [
      "Expiring in 30 Days",
      "Expiring in 60 Days",
      "Expiring in 90 Days",
      "At-Risk",
    ])

    // Control bar: status + vendor selects, search, and the two actions.
    await expect(
      page.getByLabel("Search contracts or vendors"),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /export calendar/i }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /alert settings/i }),
    ).toBeVisible()

    await expectNoErrorShell(page, "/dashboard/renewals")
  })

  test("renewals table exposes its column structure", async ({ page }) => {
    await page.goto("/dashboard/renewals")
    await expect(
      page.getByRole("heading", { name: "Contract Renewals" }),
    ).toBeVisible({ timeout: LOAD })

    const table = page.getByRole("table")
    const noContracts = content(page).getByText("No contracts on file")
    await expect(table.first().or(noContracts)).toBeVisible({ timeout: LOAD })

    // Skip (don't fail) when the seed genuinely has no contracts to renew
    // — the header/hero assertions above already covered the page itself.
    test.skip(
      await noContracts.isVisible(),
      "seed has no contracts, so there is no renewals table to assert on",
    )

    // Status tabs are rendered from STATUS_TABS with live counts appended,
    // e.g. "Critical (3)" — match on the prefix so counts can move.
    for (const label of ["All", "Critical", "Warning", "Upcoming", "On Track"]) {
      await expect(
        page.getByRole("tab", { name: new RegExp(`^${label} \\(`) }),
      ).toBeVisible()
    }

    for (const header of [
      "Status",
      "Contract",
      "Vendor",
      "Expires",
      "Days Left",
    ]) {
      await expect(
        page.getByRole("columnheader", { name: header, exact: true }),
        `renewals table is missing the "${header}" column`,
      ).toBeVisible()
    }
    // "Commitment" carries an inline help button, so its accessible name
    // is not an exact match — assert on the prefix.
    await expect(
      page.getByRole("columnheader", { name: /^Commitment/ }),
    ).toBeVisible()

    await expectNoErrorShell(page, "/dashboard/renewals")
  })
})

// ─── /dashboard/case-costing ─────────────────────────────────

test.describe("case costing", () => {
  test("explainer, hero and all five tabs render", async ({ page }) => {
    await page.goto("/dashboard/case-costing")

    await expect(
      page.getByRole("heading", { name: "How Case Costing Works" }),
    ).toBeVisible({ timeout: LOAD })

    await expectHeroStats(page, [
      "Total Cases",
      "Avg Cost / Case",
      "Avg Margin",
      "On-Contract Rate",
    ])

    // The hero headline is scoped to the caller's own facility. This is
    // the tenant-isolation tell: a facility user must never see the
    // sibling "Lighthouse Community Hospital" here. `cases?` because the
    // headline singularizes at exactly one case.
    await expect(
      content(page).getByText(new RegExp(`cases? costed.*${DEMO_FACILITY}`)),
    ).toBeVisible({ timeout: LOAD })

    for (const tab of [
      "Cases",
      "Surgeons",
      "Financial",
      "Compliance",
      "Payor Contracts",
    ]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible()
    }

    await expectNoErrorShell(page, "/dashboard/case-costing")
  })

  test("Cases tab renders its table or a real empty state", async ({
    page,
  }) => {
    await page.goto("/dashboard/case-costing")
    await expect(page.getByRole("tab", { name: "Cases" })).toBeVisible({
      timeout: LOAD,
    })

    // "cases" is the default tab; click anyway so the test still holds if
    // the default changes.
    await page.getByRole("tab", { name: "Cases" }).click()

    const table = page.getByRole("table")
    const empty = content(page).getByText("No cases match")
    await expect(table.first().or(empty)).toBeVisible({ timeout: LOAD })

    await expectNoErrorShell(page, "/dashboard/case-costing (Cases tab)")
  })
})

// ─── /dashboard/purchase-orders ──────────────────────────────

test.describe("purchase orders", () => {
  test("hero, filter controls and PO table render", async ({ page }) => {
    await page.goto("/dashboard/purchase-orders")

    await expectHeroStats(page, [
      "Total POs",
      "On-Contract Spend",
      "Off-Contract Spend",
      "Pending Approval",
    ])

    // POList swaps the whole toolbar + table for an empty card when the
    // facility has zero POs, so branch on that rather than assuming seed
    // contents.
    const emptyCard = content(page).getByText("No purchase orders yet").first()
    const search = page.getByLabel("Search purchase orders")
    await expect(search.or(emptyCard)).toBeVisible({ timeout: LOAD })

    test.skip(
      !(await search.isVisible()),
      "seed has no purchase orders for this facility",
    )

    // Filter controls: search + vendor select + status select.
    await expect(search).toBeVisible()
    await expect(content(page).getByText("All Vendors")).toBeVisible()
    await expect(content(page).getByText("All Status")).toBeVisible()

    // Scope tabs carry live counts, e.g. "On Contract (12)".
    for (const label of ["All", "On Contract", "Off Contract", "Pending"]) {
      await expect(
        page.getByRole("tab", { name: new RegExp(`^${label} \\(`) }),
      ).toBeVisible()
    }

    for (const header of [
      "PO ID",
      "Vendor",
      "Contract",
      "Status",
      "Created",
      "Items",
      "Total",
    ]) {
      await expect(
        page.getByRole("columnheader", { name: header, exact: true }),
        `PO table is missing the "${header}" column`,
      ).toBeVisible()
    }

    await expectNoErrorShell(page, "/dashboard/purchase-orders")
  })
})

// ─── /dashboard/invoice-validation ───────────────────────────

test.describe("invoice validation", () => {
  test("hero, control bar, tabs and discrepancy table render", async ({
    page,
  }) => {
    await page.goto("/dashboard/invoice-validation")

    await expectHeroStats(page, [
      "Total Invoices",
      "Awaiting Review",
      "Flagged Variance",
      "Recovered",
    ])

    // Control bar: search + vendor filter + dispute filter + actions.
    await expect(
      page.getByPlaceholder(/search invoices or vendors/i),
    ).toBeVisible({ timeout: LOAD })
    await expect(
      content(page).getByText("Vendor", { exact: true }).first(),
    ).toBeVisible()
    await expect(
      content(page).getByText("Dispute", { exact: true }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /upload invoice/i }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: /^export$/i })).toBeVisible()

    // Status tabs carry live counts, e.g. "Flagged Variances (4)".
    for (const label of [
      "Awaiting Review",
      "Flagged Variances",
      "Approved",
      "Disputed",
      "All",
    ]) {
      await expect(
        page.getByRole("tab", { name: new RegExp(`^${label} \\(`) }),
      ).toBeVisible()
    }

    // InvoiceDiscrepancyTable always renders its header row, empty or not,
    // so these columns are safe to assert regardless of seed contents.
    for (const header of [
      "Invoice",
      "Vendor",
      "Date",
      "Invoiced",
      "Contract",
      "Variance",
      "Status",
    ]) {
      await expect(
        page.getByRole("columnheader", { name: header, exact: true }),
        `invoice table is missing the "${header}" column`,
      ).toBeVisible()
    }

    await expectNoErrorShell(page, "/dashboard/invoice-validation")
  })
})

// ─── /dashboard/reports ──────────────────────────────────────

test.describe("reports hub", () => {
  test("hero, filters and the report tab list render", async ({ page }) => {
    await page.goto("/dashboard/reports")

    await expectHeroStats(page, [
      "Contracts",
      "Vendors",
      "Active Schedules",
      "Last Sent",
    ])

    // Filter bar: vendor + contract selects, both defaulted to "all".
    await expect(content(page).getByText("Filters")).toBeVisible({
      timeout: LOAD,
    })
    await expect(content(page).getByText("All Vendors")).toBeVisible()
    await expect(content(page).getByText("All Contracts")).toBeVisible()

    // At least one report is offered. With no contract selected the tab
    // router exposes the full set; assert the two stable anchors plus a
    // polled count, because `.count()` alone does NOT auto-retry and the
    // tabs mount after the contracts query resolves.
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible({
      timeout: LOAD,
    })
    await expect(
      page.getByRole("tab", { name: "By Rebate Type" }),
    ).toBeVisible()
    await expect
      .poll(() => page.getByRole("tab").count(), { timeout: LOAD })
      .toBeGreaterThan(1)

    // Overview tab content — proves a report actually rendered, not just
    // that its tab exists.
    await expect(content(page).getByText("Contract Lifecycle")).toBeVisible({
      timeout: LOAD,
    })
    await expect(
      content(page).getByText("Monthly Spend & Rebate"),
    ).toBeVisible()

    // Export + the price-discrepancy drill-down are the hub's two exits.
    await expect(
      page.getByRole("button", { name: /download pdf/i }),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: /price discrepancy/i }),
    ).toBeVisible()

    await expectNoErrorShell(page, "/dashboard/reports")
  })
})

// ─── /dashboard/alerts ───────────────────────────────────────

test.describe("alerts", () => {
  test("hero, toolbar filters and the inbox render", async ({ page }) => {
    await page.goto("/dashboard/alerts")

    await expectHeroStats(page, [
      "Off-Contract",
      "Expiring",
      "Rebates Due",
      "Total Unresolved",
    ])

    // Toolbar: search + type select + severity toggle group + status select.
    await expect(page.getByPlaceholder(/search alerts/i)).toBeVisible({
      timeout: LOAD,
    })
    await expect(content(page).getByText("All types")).toBeVisible()
    // ToggleGroup type="single" renders role=radiogroup / role=radio.
    for (const severity of ["All", "High", "Medium", "Low"]) {
      await expect(
        page.getByRole("radio", { name: severity, exact: true }),
        `severity filter is missing "${severity}"`,
      ).toBeVisible()
    }
    await expect(page.getByRole("button", { name: /mark all read/i })).toBeVisible()

    // The inbox resolves to grouped rows, the "All clear" state, or the
    // filtered-out state — never a stuck skeleton. Group headers read
    // "High priority" / "Medium priority" / "Low priority" (the count
    // rides alongside in a badge, so it is not part of the label).
    const severityGroups = content(page).getByText(
      /(High|Medium|Low) priority/,
    )
    const allClear = content(page).getByRole("heading", { name: "All clear" })
    const noMatch = content(page).getByText(/no alerts match your filters/i)
    await expect(
      severityGroups.first().or(allClear).or(noMatch),
    ).toBeVisible({ timeout: LOAD })

    await expectNoErrorShell(page, "/dashboard/alerts")
  })
})

// ─── /dashboard/cog-data ─────────────────────────────────────

test.describe("cog data", () => {
  // NOTE: the COG import dialog is already covered end-to-end by
  // cog-import-dedup.spec.ts. This block deliberately stays on the page
  // itself — hero, toolbar, tabs, and the records table's filter/sort
  // controls — and never opens the importer.
  test("hero, control bar and tabs render", async ({ page }) => {
    await page.goto("/dashboard/cog-data")

    await expectHeroStats(page, [
      "Total Spend",
      "On-Contract",
      "Total Records",
      "Data Range",
    ])

    // Control bar: date-range pickers plus the mapping/matching actions.
    await expect(content(page).getByText("Date range")).toBeVisible({
      timeout: LOAD,
    })
    // `exact` matters here: accessible-name matching is substring by
    // default, and a bare "To" would also hit the shell's "Toggle
    // Sidebar" trigger.
    await expect(
      page.getByRole("button", { name: "From", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "To", exact: true }),
    ).toBeVisible()
    for (const label of [
      /mass upload/i,
      /vendor mapping/i,
      /category mapping/i,
      /match pricing/i,
      /re-run match/i,
    ]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible()
    }

    for (const tab of [
      "COG Data",
      "COG Files",
      "Pricing Files",
      "Pricing List",
    ]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible()
    }

    await expectNoErrorShell(page, "/dashboard/cog-data")
  })

  test("records table exposes its search, match-status filter and sorting", async ({
    page,
  }) => {
    await page.goto("/dashboard/cog-data")
    await expect(page.getByRole("tab", { name: "COG Data" })).toBeVisible({
      timeout: LOAD,
    })

    // Anchor on a column that only the records table has. The page also
    // renders the pricing-import history table (File / Uploaded / Rows),
    // so a bare `getByRole("table").first()` could green on the wrong one.
    //
    // `.first()` throughout this test: DataTable renders a SECOND <th> row
    // under the labels when `enableColumnFilters` is on (one <ColumnFilter>
    // per column), so a name can resolve to two columnheaders. The first in
    // DOM order is always the real label row.
    const poHeader = page
      .getByRole("columnheader", { name: "PO #", exact: true })
      .first()
    const empty = content(page).getByText("No COG records yet")
    await expect(poHeader.or(empty)).toBeVisible({ timeout: LOAD })

    test.skip(
      await empty.isVisible(),
      "seed has no COG records for this facility",
    )

    // Server-side search box (deliberately not DataTable's client-side
    // searchKey — that only filtered the visible page).
    await expect(
      page.getByPlaceholder(/search description, vendor item, or inventory/i),
    ).toBeVisible()

    // Match-status filter — the select's value renders as its label.
    await expect(content(page).getByText("All match statuses")).toBeVisible()

    // Opening it must list more than the default option. Read-only: the
    // Escape below closes it without changing the filter.
    await content(page).getByText("All match statuses").click()
    await expect
      .poll(() => page.getByRole("option").count(), { timeout: LOAD })
      .toBeGreaterThan(1)
    await page.keyboard.press("Escape")

    // Column headers, and sorting actually toggling on click. DataTable
    // wires getToggleSortingHandler() onto <TableHead> and reflects state
    // via aria-sort, so this asserts the sort is real, not decorative.
    for (const header of ["PO #", "Description", "Vendor", "Category"]) {
      await expect(
        page.getByRole("columnheader", { name: header, exact: true }).first(),
        `COG table is missing the "${header}" column`,
      ).toBeVisible()
    }

    const description = page
      .getByRole("columnheader", { name: "Description", exact: true })
      .first()
    // DataTable starts with `sorting: []`, so aria-sort is absent until a
    // header is clicked. Asserting the "before" state is what makes the
    // "after" state proof that the click did something.
    await expect(description).not.toHaveAttribute("aria-sort", "ascending")
    await description.click()
    await expect(description).toHaveAttribute("aria-sort", "ascending")

    await expectNoErrorShell(page, "/dashboard/cog-data")
  })
})
