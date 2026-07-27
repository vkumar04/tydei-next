import { test, expect, type Locator, type Page } from "@playwright/test"

/**
 * E2E: the VENDOR and ADMIN surfaces nobody was watching.
 *
 * `vendor-flow.spec.ts` only smoke-tests four vendor routes (dashboard /
 * contracts / pending / invoices) and only asserts "status < 500" — which a
 * page that renders the error boundary still passes, because the boundary is
 * a 200. `admin-users-nav.spec.ts` covers /admin/users and nothing else. So
 * six vendor routes, the whole vendor Settings tab strip, the vendor
 * submission form and four of the five admin sections had zero coverage.
 *
 * Everything here is READ-ONLY on purpose: the suite runs serially against a
 * shared seeded database (workers=1, retries=0), so a spec that writes rows
 * passes once and then rots. The one interactive test — the Settings tab
 * strip — only clicks tabs, which is local component state.
 *
 * Deliberately NOT asserted: dollar amounts, row counts, contract names.
 * Seed data churns. What's asserted is structure — the heading each page
 * owns, the tab it owns, the fields the form owns, and that no page fell
 * through to an error boundary.
 */

// ─── Shared helpers ──────────────────────────────────────────

/**
 * The failure mode this whole file exists to catch.
 *
 * `components/shared/error-boundary-card.tsx` renders `<h2>Something went
 * wrong</h2>` + a "Try Again" button, and is what /vendor/error.tsx and
 * /admin/error.tsx both fall back to. It serves HTTP 200, so the existing
 * `expect(resp.status()).toBeLessThan(500)` smoke tests sail straight past
 * it. "Application error" is Next's own client-side crash screen.
 *
 * `toHaveCount(0)` (not `.count()`) so the assertion auto-retries — a
 * boundary that renders one tick after hydration still gets caught.
 */
async function expectNoErrorBoundary(page: Page, where: string) {
  await expect(
    page.getByRole("heading", { name: /something went wrong/i }),
    `${where} rendered the error boundary`,
  ).toHaveCount(0)
  await expect(
    page.getByText(/application error/i),
    `${where} rendered Next's client crash screen`,
  ).toHaveCount(0)
}

// ─── Vendor: read-only analytics + ops surfaces ──────────────

test.describe("vendor portal surfaces render their own content", () => {
  test.use({ storageState: "tests/e2e/.auth/vendor.json" })

  /**
   * Each entry names something ONLY that page renders. A shared marker
   * (e.g. the sidebar, or the word "Vendor") would still pass if the router
   * quietly served a different route, which is the regression shape here —
   * /admin/users used to bounce back to the dashboard and looked fine.
   */
  const VENDOR_SURFACES: ReadonlyArray<{
    path: string
    /** Rendered by the server/first paint, before any query resolves. */
    shell: (page: Page) => Locator
    /** Rendered only once the page's own client query has landed. */
    loaded: (page: Page) => Locator
  }> = [
    {
      path: "/vendor/market-share",
      shell: (page) =>
        page.getByRole("heading", { name: "Market Share Analysis" }),
      // The tab strip lives inside the `isLoading || !data` branch's else,
      // so seeing it proves getVendorMarketShare actually resolved rather
      // than the page sitting on skeletons forever.
      loaded: (page) => page.getByRole("tab", { name: "Competitors" }),
    },
    {
      path: "/vendor/performance",
      // The hero headline is data-derived ("$X delivered across N
      // contracts" vs "No active contract performance data yet"), so the
      // stable handle is the tab strip, which renders unconditionally.
      shell: (page) => page.getByRole("tab", { name: "Rebate Progress" }),
      // .first(): "Avg Compliance" is also a stat inside the Rebate
      // Progress panel. Radix only mounts the active panel so there is one
      // match today, but the hero copy is the one we mean either way.
      loaded: (page) => page.getByText("Avg Compliance").first(),
    },
    {
      path: "/vendor/renewals",
      // Present in BOTH branches — the empty state ("No Expiring
      // Contracts") keeps the same PageHeader title.
      shell: (page) => page.getByRole("heading", { name: "Contract Renewals" }),
      loaded: (page) =>
        page
          .getByRole("tab")
          .or(page.getByRole("heading", { name: "No Expiring Contracts" }))
          .first(),
    },
    {
      path: "/vendor/reports",
      shell: (page) => page.getByText("Generated (MTD)"),
      // The Reports Hub section header — the interactive surface that sits
      // above the CSV export grid.
      loaded: (page) =>
        page.getByRole("heading", { name: "Contract Performance Details" }),
    },
    {
      path: "/vendor/purchase-orders",
      // Server-rendered <h1> in app/vendor/purchase-orders/page.tsx.
      shell: (page) => page.getByRole("heading", { name: "Purchase Orders" }),
      loaded: (page) => page.getByRole("tab", { name: /^Fulfilled/ }),
    },
    {
      path: "/vendor/alerts",
      shell: (page) =>
        page.getByText("Contract expirations, compliance issues, and action items"),
      // "Medium Priority", not "Unresolved" or "High Priority": those two
      // also appear lowercase inside the hero headline ("3 unresolved · 1
      // high priority") and getByText is case-insensitive by default, so
      // either would be a strict-mode violation the moment an alert exists.
      loaded: (page) => page.getByText("Medium Priority"),
    },
  ]

  for (const surface of VENDOR_SURFACES) {
    test(`${surface.path} renders`, async ({ page }) => {
      await page.goto(surface.path)
      // A vendor bounced to /vendor/dashboard (bad session, wrong role
      // gate) would otherwise still satisfy "no error boundary".
      await expect(page).toHaveURL(new RegExp(`${surface.path}$`), {
        timeout: 20_000,
      })

      await expect(surface.shell(page)).toBeVisible({ timeout: 20_000 })
      await expect(surface.loaded(page)).toBeVisible({ timeout: 20_000 })

      await expectNoErrorBoundary(page, surface.path)
      // Re-check after the content landed: a late redirect (the /admin/users
      // bug class — it bounced ~3-4s AFTER painting) would show up here.
      await expect(page).toHaveURL(new RegExp(`${surface.path}$`))
    })
  }
})

// ─── Vendor: Settings tab strip ──────────────────────────────

test.describe("vendor settings", () => {
  test.use({ storageState: "tests/e2e/.auth/vendor.json" })

  test("every tab in the strip opens its own panel", async ({ page }) => {
    await page.goto("/vendor/settings")

    // /vendor/settings redirects to /vendor/dashboard for anyone without
    // `settings.view`. demo-vendor@tydei.com's Member row has no explicit
    // accessTier, and the Prisma column defaults to `super`, so landing
    // anywhere else is a real regression in the permission matrix — assert
    // it rather than skipping.
    await expect(page).toHaveURL(/\/vendor\/settings$/, { timeout: 20_000 })

    // Scoped to the FIRST tablist, not `page.getByRole("tab")`: if some
    // panel ever renders its own nested tab strip, a page-wide tab locator
    // would grow mid-loop and every `nth(i)` after that point would address
    // the wrong trigger. The settings strip precedes every panel in the DOM,
    // so `.first()` is the outer one.
    const tabStrip = page.getByRole("tablist").first()
    const tabs = tabStrip.getByRole("tab")
    await expect(tabs.first()).toBeVisible({ timeout: 20_000 })

    // Enumerated, NOT hard-coded: the strip is built by mapping over a
    // `tabs` array in vendor-settings-client.tsx, so a newly added entry is
    // covered the moment it ships. The count is stable by the time the
    // first tab is visible — the array is static, not query-driven.
    const tabCount = await tabs.count()
    expect(tabCount, "vendor settings should have a multi-tab strip").toBeGreaterThan(1)

    for (let i = 0; i < tabCount; i++) {
      const tab = tabs.nth(i)
      const label = (await tab.textContent())?.trim() || `tab #${i}`

      await tab.click()
      await expect(tab, `"${label}" did not become the selected tab`).toHaveAttribute(
        "aria-selected",
        "true",
      )

      // Radix mounts ONLY the active panel, so "the panel exists and is
      // visible" is a real assertion that this tab has a TabsContent wired
      // to it — a tab added to the array without a matching panel fails
      // here instead of silently rendering nothing.
      const panelId = await tab.getAttribute("aria-controls")
      expect(panelId, `"${label}" has no aria-controls → no panel`).toBeTruthy()
      // Attribute selector, not `#id`: Radix ids come from React's useId
      // and contain characters CSS id selectors would need escaped.
      const panel = page.locator(`[id="${panelId}"]`)
      await expect(panel, `"${label}" panel never rendered`).toBeVisible({
        timeout: 20_000,
      })

      await expectNoErrorBoundary(page, `/vendor/settings → "${label}"`)
    }
  })
})

// ─── Vendor: contract submission form ────────────────────────

test.describe("vendor contract submission", () => {
  test.use({ storageState: "tests/e2e/.auth/vendor.json" })

  test("contracts/new renders the required submission fields", async ({
    page,
  }) => {
    await page.goto("/vendor/contracts/new")
    await expect(
      page.getByRole("heading", { name: "Submit New Contract" }),
    ).toBeVisible({ timeout: 20_000 })

    // The form renders below the entry-mode tabs regardless of which entry
    // mode is selected (default is "ai"), so these are always present.
    // Labels carry a trailing " *" for the server-required fields — that
    // asterisk is the contract with the user and worth pinning.
    await expect(page.getByText("Contract Name *")).toBeVisible()
    await expect(page.getByText("Contract Type *")).toBeVisible()
    await expect(page.getByText("Effective Date *")).toBeVisible()
    await expect(page.getByText("Expiration Date *")).toBeVisible()

    // Label→input wiring (htmlFor="contractName" / id="contractName").
    // getByLabel fails if that pairing ever breaks, which a plain
    // getByText on the label would not catch.
    await expect(page.getByLabel("Contract Name *")).toBeEditable()

    // The three cards the payload builder reads from.
    await expect(page.getByText("Basic Information")).toBeVisible()
    await expect(page.getByText("Contract Dates")).toBeVisible()
    await expect(page.getByText("Financial Details")).toBeVisible()

    // Submit affordance — present and enabled, but deliberately NOT
    // clicked: this suite must be re-runnable and a submission writes a
    // PendingContract row.
    const submit = page.getByRole("button", { name: "Submit for Review" })
    await expect(submit).toBeVisible()
    await expect(submit).toBeEnabled()

    await expectNoErrorBoundary(page, "/vendor/contracts/new")
  })
})

// ─── Admin: dashboard + section navigation ───────────────────

test.describe("admin portal", () => {
  test.use({ storageState: "tests/e2e/.auth/admin.json" })

  test("/admin lands on the dashboard and renders its stat cards", async ({
    page,
  }) => {
    // app/admin/page.tsx is a bare redirect() to /admin/dashboard.
    await page.goto("/admin")
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 20_000 })

    await expect(
      page.getByRole("heading", { name: "Admin Dashboard" }),
    ).toBeVisible({ timeout: 20_000 })

    // The four stat cards. These are the `stats.data ? … : <Skeleton/>`
    // branch, so seeing all four proves /api/admin/dashboard resolved —
    // the Route Handler that replaced the three Server Actions which used
    // to yank you off this page mid-navigation.
    //
    // Labels only. The VALUES are seed-dependent (and MRR is formatted
    // "$X.XK"), so asserting them would rot on the next `bun run db:seed`.
    for (const label of [
      "Total Facilities",
      "Total Vendors",
      "Total Users",
      "Monthly Revenue",
    ]) {
      await expect(page.getByText(label), `missing stat card: ${label}`).toBeVisible({
        timeout: 20_000,
      })
    }

    // Platform Performance panel — renders "--" placeholders until stats
    // land, so assert the labels, not the numbers.
    await expect(page.getByText("Contracts Processed")).toBeVisible()
    await expect(page.getByText("Active Contracts")).toBeVisible()

    await expectNoErrorBoundary(page, "/admin/dashboard")
  })

  /**
   * Every primary admin section EXCEPT Users, which admin-users-nav.spec.ts
   * already owns end-to-end.
   *
   * Clicked from the sidebar rather than page.goto: a <Link> navigation goes
   * through the Router Cache and prefetch, which is a different code path
   * from a full document load, and is exactly where the "clicking Users
   * redirects me to the dashboard" bug lived.
   */
  const ADMIN_SECTIONS: ReadonlyArray<{
    navLabel: string
    path: string
    url: RegExp
    heading: string
    /** Content the section's own client component owns. */
    content: (page: Page) => Locator
  }> = [
    {
      navLabel: "Facilities",
      path: "/admin/facilities",
      url: /\/admin\/facilities/,
      heading: "Facilities",
      content: (page) => page.getByText("Manage healthcare facilities and their access"),
    },
    {
      navLabel: "Payor Contracts",
      path: "/admin/payor-contracts",
      url: /\/admin\/payor-contracts/,
      heading: "Payor Contracts",
      content: (page) =>
        page.getByText(
          "Manage payor contract rates for accurate case costing reimbursement",
        ),
    },
    {
      navLabel: "Vendors",
      path: "/admin/vendors",
      url: /\/admin\/vendors/,
      heading: "Vendors",
      content: (page) => page.getByText("Manage vendor organizations and their access"),
    },
    {
      navLabel: "Billing",
      path: "/admin/billing",
      url: /\/admin\/billing/,
      heading: "Billing & Invoices",
      content: (page) => page.getByText("Manage platform billing and subscription invoices"),
    },
  ]

  for (const section of ADMIN_SECTIONS) {
    test(`sidebar → ${section.navLabel} renders content, not a redirect shell`, async ({
      page,
    }) => {
      await page.goto("/admin/dashboard")
      await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 20_000 })

      // Scoped to the sidebar <nav> so it can't match a Quick Action card
      // link on the dashboard body ("Onboard New Facility" etc.).
      await page
        .getByRole("navigation")
        .first()
        .getByRole("link", { name: section.navLabel, exact: true })
        .click()

      await expect(page).toHaveURL(section.url, { timeout: 20_000 })
      await expect(
        page.getByRole("heading", { name: section.heading, exact: true }),
      ).toBeVisible({ timeout: 20_000 })
      await expect(section.content(page)).toBeVisible({ timeout: 20_000 })

      await expectNoErrorBoundary(page, `/admin → ${section.navLabel}`)
      // Still here after the content painted — the late-bounce check.
      await expect(page).toHaveURL(section.url)
    })

    test(`${section.navLabel} survives a hard reload`, async ({ page }) => {
      // Full document load is the other half of the pair: the <Link> path
      // above goes through the Router Cache, this one doesn't.
      await page.goto(section.path)
      await expect(page).toHaveURL(section.url, { timeout: 20_000 })
      await page.reload()
      await expect(page).toHaveURL(section.url, { timeout: 20_000 })
      await expect(
        page.getByRole("heading", { name: section.heading, exact: true }),
      ).toBeVisible({ timeout: 20_000 })
      await expectNoErrorBoundary(page, `${section.path} after reload`)
    })
  }
})
