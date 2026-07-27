import { test, expect, type Page } from "@playwright/test"

/**
 * E2E: cross-cutting invariants.
 *
 * These are the app-wide properties that no single feature owns, so no
 * single feature spec catches them when they break. Each one maps to a
 * class of incident CLAUDE.md calls out:
 *
 *  1. No authenticated page scrolls horizontally (commit 789302e3 — a
 *     SHELL bug that broke 26 of 27 routes at once).
 *  2. Tenant isolation holds at the ROUTING layer: a facility session can
 *     never render /vendor/*, a vendor session can never render
 *     /dashboard/*, and neither can render /admin/*.
 *  3. Every authenticated page still renders the app shell. A page that
 *     loses the sidebar + search is the visible symptom of a server
 *     component throwing above the page.
 *  4. Deep links survive stale/bogus query params. A `?tab=` value that no
 *     longer exists (the removed Analytics tab) must fall back, not crash.
 *  5. An unmatched route renders the 404 page, not an error boundary — and
 *     a contract id the caller does not own is indistinguishable from one
 *     that does not exist (no existence oracle).
 *
 * Everything here is READ-ONLY. No test creates, edits or deletes a row, so
 * the file is re-runnable against the same seeded database forever.
 *
 * Route lists are data — add a route to the arrays below and it is covered.
 *
 * ── Relationship to tests/e2e/responsive-overflow.spec.ts ──
 * That spec covers DEPTH: 4 routes × 3 breakpoints (375 / 768 / 1280),
 * because 768 is where the sidebar becomes inline and the shell bug bites.
 * This spec covers BREADTH: many more routes at a single desktop width, to
 * catch a *page*-level overflow that the 4-route sample would miss. They are
 * deliberately disjoint — no route appears in both lists.
 */

// ─── Shared route data ───────────────────────────────────────────

type Portal = "facility" | "vendor"

const STORAGE_STATE: Record<Portal, string> = {
  facility: "tests/e2e/.auth/facility.json",
  vendor: "tests/e2e/.auth/vendor.json",
}

/**
 * A nav item only this portal has. Asserting on it proves PortalShell was
 * handed the RIGHT navItems list, not merely that some sidebar rendered.
 */
const NAV_MARKER: Record<Portal, string> = {
  facility: "COG Data",
  vendor: "Market Share",
}

/**
 * Authenticated routes covered by the shell + overflow loops.
 *
 * Deliberately excludes /dashboard, /dashboard/contracts, /vendor/dashboard
 * and /admin/users — responsive-overflow.spec.ts already measures those at
 * three widths, and duplicating them here would just slow the suite down.
 */
const AUTHED_ROUTES: { portal: Portal; path: string }[] = [
  { portal: "facility", path: "/dashboard/renewals" },
  { portal: "facility", path: "/dashboard/rebate-optimizer" },
  { portal: "facility", path: "/dashboard/cog-data" },
  { portal: "facility", path: "/dashboard/case-costing" },
  { portal: "facility", path: "/dashboard/purchase-orders" },
  { portal: "facility", path: "/dashboard/reports" },
  { portal: "facility", path: "/dashboard/settings" },
  { portal: "vendor", path: "/vendor/contracts" },
  { portal: "vendor", path: "/vendor/prospective" },
  { portal: "vendor", path: "/vendor/market-share" },
  { portal: "vendor", path: "/vendor/performance" },
  { portal: "vendor", path: "/vendor/purchase-orders" },
  { portal: "vendor", path: "/vendor/invoices" },
  { portal: "vendor", path: "/vendor/settings" },
]

const routesFor = (portal: Portal) =>
  AUTHED_ROUTES.filter((r) => r.portal === portal)

// ─── Shared helpers ──────────────────────────────────────────────

/**
 * The app shell = sidebar (brand + portal nav) + header (global search).
 *
 * Both live in PortalShell, ABOVE the page in the tree, so if a page's
 * server component throws, the segment error boundary replaces the page but
 * the shell survives — and if the LAYOUT throws, the shell disappears
 * entirely. That second case is what this asserts against.
 */
async function expectAppShell(page: Page, portal: Portal) {
  // Sidebar brand mark (links to "/").
  await expect(page.getByRole("link", { name: /TYDEi/i }).first()).toBeVisible({
    timeout: 20_000,
  })

  // SidebarNav renders the only <nav> in the shell; scoping to it keeps the
  // marker from matching an in-page link with the same label (e.g. the
  // "Market Share" heading links on the vendor dashboard).
  const sidebarNav = page.getByRole("navigation").first()
  await expect(
    sidebarNav.getByRole("link", { name: NAV_MARKER[portal] }),
  ).toBeVisible({ timeout: 20_000 })

  // CommandSearch trigger. Scoped to the shell <header> so /search/i can
  // only be the global palette, never a per-page filter input.
  await expect(
    page.locator("header").first().getByRole("button", { name: /search/i }),
  ).toBeVisible({ timeout: 20_000 })
}

/**
 * No error boundary took over. Covers ErrorBoundaryCard (shared by the
 * /dashboard, /vendor and /admin segment error.tsx files) and the bespoke
 * /vendor/prospective one.
 */
async function expectNoErrorBoundary(page: Page) {
  await expect(page.getByText("Something went wrong")).toHaveCount(0)
  await expect(page.getByText("Something broke on this page")).toHaveCount(0)
}

/**
 * Wait for the page to be worth measuring, without an arbitrary sleep.
 *
 * The shell assertion is the real gate (it retries until the layout paints);
 * `networkidle` then gives client-side TanStack Query a chance to land the
 * tables that are the usual overflow culprits. It is wrapped in `.catch`
 * because AlertBell polls every 30s — a poll landing mid-wait must not fail
 * the test, and the shell gate above already proved the page rendered.
 */
async function settle(page: Page, portal: Portal) {
  await expectAppShell(page, portal)
  await expect(page.locator("main")).toBeVisible({ timeout: 20_000 })
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {})
}

/**
 * Horizontal overflow in CSS pixels. 0 means the page fits.
 *
 * Compares against `documentElement.clientWidth`, NOT `window.innerWidth`:
 * innerWidth includes the vertical scrollbar gutter, so it would mask up to
 * ~15px of genuine overflow. `<main>` is `overflow-auto`, so a wide data
 * table scrolls inside itself and is correctly NOT counted here — this
 * measures the shell breaking out of the viewport, which is the bug class
 * 789302e3 fixed.
 */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const de = document.documentElement
    return Math.max(
      de.scrollWidth - de.clientWidth,
      document.body.scrollWidth - de.clientWidth,
    )
  })
}

// ─── 1. No horizontal scroll on authenticated pages ──────────────

/** Wide enough that the sidebar is inline and the shell must share space. */
const DESKTOP = { width: 1280, height: 900 }

for (const portal of ["facility", "vendor"] as const) {
  test.describe(`${portal} pages do not scroll horizontally`, () => {
    test.use({ storageState: STORAGE_STATE[portal] })

    for (const { path } of routesFor(portal)) {
      test(`${path} fits the viewport at ${DESKTOP.width}px`, async ({
        page,
      }) => {
        // Turbopack compiles each route on first hit; the default 30s can be
        // tight on a cold dev server.
        test.setTimeout(60_000)

        await page.setViewportSize(DESKTOP)
        await page.goto(path, { waitUntil: "domcontentloaded" })
        await settle(page, portal)

        const overflow = await horizontalOverflow(page)
        expect(
          overflow,
          `${path} @${DESKTOP.width}px overflows by ${overflow}px. If EVERY ` +
            `route in this file is failing it is the shell, not the page — ` +
            `check that SidebarInset (components/ui/sidebar.tsx, a VENDORED ` +
            `shadcn file that "shadcn add sidebar" overwrites) still has ` +
            `min-w-0, and that the PortalShell header grid still uses ` +
            `minmax(0,1fr) for the search column.`,
        ).toBeLessThanOrEqual(1)
      })
    }
  })
}

// ─── 2. Tenant isolation at the routing layer ────────────────────

/**
 * Cross-portal navigation attempts. `landsOn` is an EXACT pathname —
 * substring matching would let /vendor/dashboard satisfy a "/dashboard"
 * expectation, which is precisely the failure this guards against.
 *
 * The redirect targets come from `roleConfig[role].defaultRedirect`
 * (lib/constants.ts) via requireRole() in lib/actions/auth.ts.
 */
const CROSS_PORTAL_CASES: {
  from: Portal
  path: string
  landsOn: string
}[] = [
  // Facility session must never reach the vendor or admin portals.
  { from: "facility", path: "/vendor/dashboard", landsOn: "/dashboard" },
  { from: "facility", path: "/vendor/contracts", landsOn: "/dashboard" },
  { from: "facility", path: "/vendor/invoices", landsOn: "/dashboard" },
  { from: "facility", path: "/admin/users", landsOn: "/dashboard" },
  // Vendor session must never reach the facility or admin portals.
  { from: "vendor", path: "/dashboard", landsOn: "/vendor/dashboard" },
  { from: "vendor", path: "/dashboard/contracts", landsOn: "/vendor/dashboard" },
  { from: "vendor", path: "/dashboard/cog-data", landsOn: "/vendor/dashboard" },
  { from: "vendor", path: "/admin/users", landsOn: "/vendor/dashboard" },
]

for (const portal of ["facility", "vendor"] as const) {
  test.describe(`${portal} session is fenced into its own portal`, () => {
    test.use({ storageState: STORAGE_STATE[portal] })

    for (const { path, landsOn } of CROSS_PORTAL_CASES.filter(
      (c) => c.from === portal,
    )) {
      test(`${path} redirects to ${landsOn}`, async ({ page }) => {
        test.setTimeout(60_000)
        await page.goto(path, { waitUntil: "domcontentloaded" })

        // waitForURL with a predicate, so the match is on the exact pathname
        // rather than a regex that a longer path could satisfy.
        await page.waitForURL((url) => url.pathname === landsOn, {
          timeout: 30_000,
        })
        expect(new URL(page.url()).pathname).toBe(landsOn)

        // We landed in OUR portal, fully rendered — not on a login page and
        // not on a half-rendered foreign layout.
        await expectAppShell(page, portal)
        await expectNoErrorBoundary(page)

        // The foreign portal's nav is not reachable from here either. Derived
        // from the attempted path's first segment so admin cases work too.
        const foreignPrefix = `/${path.split("/")[1]}`
        await expect(
          page.locator(`nav a[href^="${foreignPrefix}"]`),
        ).toHaveCount(0)
      })
    }
  })
}

// ─── 3. Every authenticated page renders the app shell ───────────

for (const portal of ["facility", "vendor"] as const) {
  test.describe(`${portal} pages render the app shell`, () => {
    test.use({ storageState: STORAGE_STATE[portal] })

    for (const { path } of routesFor(portal)) {
      test(`${path} keeps sidebar nav + global search`, async ({ page }) => {
        test.setTimeout(60_000)
        await page.goto(path, { waitUntil: "domcontentloaded" })

        // Still on the requested route — not bounced to /login by an expired
        // storage state, which would make the shell assertion meaningless.
        expect(new URL(page.url()).pathname).toBe(path)

        await expectAppShell(page, portal)
        await expectNoErrorBoundary(page)
      })
    }
  })
}

// ─── 4. Deep-link robustness: stale / bogus ?tab= ────────────────

/**
 * `?tab=analytics` is not hypothetical: an Analytics tab was removed from
 * these surfaces, so bookmarks and shared links carrying it are in the wild.
 * The invariant is that an unknown tab id falls back to a valid tab and
 * renders — never a blank page or an error boundary.
 *
 * `fallbackTab` is the accessible name of the tab that must end up selected.
 */
const STALE_TAB_LINKS: {
  portal: Portal
  path: string
  fallbackTab: RegExp
}[] = [
  // Vendor prospective — where the Analytics tab actually lived.
  { portal: "vendor", path: "/vendor/prospective", fallbackTab: /^Opportunities$/ },
  // Facility analysis hub (outer Current State / Evaluate Proposals tabs).
  {
    portal: "facility",
    path: "/dashboard/analysis/prospective",
    fallbackTab: /^Current State$/,
  },
  // Case costing DOES read ?tab= and validates it against an allowlist.
  { portal: "facility", path: "/dashboard/case-costing", fallbackTab: /^Cases$/ },
]

for (const portal of ["facility", "vendor"] as const) {
  test.describe(`${portal} tabbed pages survive a stale ?tab=`, () => {
    test.use({ storageState: STORAGE_STATE[portal] })

    for (const { path, fallbackTab } of STALE_TAB_LINKS.filter(
      (t) => t.portal === portal,
    )) {
      test(`${path}?tab=analytics falls back instead of crashing`, async ({
        page,
      }) => {
        test.setTimeout(60_000)
        await page.goto(`${path}?tab=analytics`, {
          waitUntil: "domcontentloaded",
        })

        await expectAppShell(page, portal)
        await expectNoErrorBoundary(page)

        // The page's primary tab strip is the first tablist in the DOM;
        // scoping to it keeps nested tabs (dialogs, force-mounted panels)
        // from making the selected-tab count ambiguous.
        const tablist = page.getByRole("tablist").first()
        await expect(tablist).toBeVisible({ timeout: 20_000 })

        // Exactly one tab is selected — "analytics" matched nothing, so a
        // naive implementation could leave zero panels active (blank page).
        const selected = tablist.getByRole("tab", { selected: true })
        await expect(selected).toHaveCount(1)
        await expect(selected).toHaveAccessibleName(fallbackTab)

        // And the fallback tab's panel actually has content behind it.
        await expect(page.getByRole("tabpanel").first()).toBeVisible({
          timeout: 20_000,
        })
      })
    }
  })
}

test.describe("facility analysis ?tab= deep link", () => {
  test.use({ storageState: STORAGE_STATE.facility })

  /**
   * KNOWN BUG — the ?tab= round-trip on /dashboard/analysis/prospective is
   * write-only, so a bookmarked or shared tab link never restores.
   *
   * ProspectiveClient (components/facility/analysis/prospective/
   * prospective-client.tsx) has an effect commented "Sync active tab → ?tab=
   * URL param so reloads stay put", which does:
   *
   *     router.replace(`?tab=${activeTab}`)
   *
   * But its only caller, AnalysisPageClient
   * (components/facility/analysis/analysis-page-client.tsx:62), hard-codes
   *
   *     initialTab={null}       // also initialCompareId={null}, initialVendorId={null}
   *
   * so `asTab(null)` always resolves to "upload". Nothing ever READS the
   * param back. Worse, the effect fires on mount and immediately
   * router.replace()s the user's `?tab=compare` to `?tab=upload`, destroying
   * the deep link on arrival. `?compare=` and `?vendor=` are dropped the same
   * way — the props exist and are threaded through, they are just never fed.
   *
   * The fix is to read the params in app/dashboard/analysis/prospective/
   * page.tsx (via its `searchParams`) and pass them down instead of null.
   *
   * Expected once fixed: arriving with ?tab=compare and opening the Evaluate
   * Proposals surface lands on the Compare tab. Today it lands on Upload.
   */
  test("?tab=compare restores the Compare tab", async ({ page }) => {
    // Expected to fail until the bug above is fixed. When it starts passing,
    // Playwright reports it as an unexpected pass — delete this line then.
    test.fail()
    test.setTimeout(60_000)
    await page.goto("/dashboard/analysis/prospective?tab=compare", {
      waitUntil: "domcontentloaded",
    })
    await expectAppShell(page, "facility")

    // The prospective surface lives behind the outer "Evaluate Proposals"
    // tab; ProspectiveClient does not mount until it is opened.
    await page
      .getByRole("tab", { name: /evaluate proposals/i })
      .click({ timeout: 20_000 })

    // Inner tab strip: Upload / Manual / Proposals / Pricing / Compare.
    const compareTab = page.getByRole("tab", { name: /^Compare$/ })
    await expect(compareTab).toBeVisible({ timeout: 20_000 })
    await expect(compareTab).toHaveAttribute("aria-selected", "true")
  })
})

// ─── 5. Unmatched routes render the 404 page ─────────────────────

test.describe("not-found handling", () => {
  test.use({ storageState: STORAGE_STATE.facility })

  /**
   * Bogus ids are inert strings, never a seeded value — nothing here depends
   * on `bun run db:seed` output, and nothing is mutated.
   */
  const NOT_FOUND_ROUTES = [
    // No route file matches this segment at all.
    "/dashboard/does-not-exist",
    // The route file matches, but getContract's findUniqueOrThrow is scoped
    // by contractOwnershipWhere, so an unknown OR unowned id both raise P2025
    // and the page calls notFound(). That equivalence is the point: a
    // facility must not be able to tell "someone else's contract" apart from
    // "no such contract" — that difference is an existence oracle across
    // tenants.
    "/dashboard/contracts/not-a-real-contract-id",
  ]

  for (const path of NOT_FOUND_ROUTES) {
    test(`${path} renders the 404 page, not an error boundary`, async ({
      page,
    }) => {
      test.setTimeout(60_000)
      const response = await page.goto(path, { waitUntil: "domcontentloaded" })

      // app/not-found.tsx — heading, copy and the escape hatch.
      await expect(page.getByText("404", { exact: true })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.getByText("Page not found")).toBeVisible()
      await expect(page.getByRole("link", { name: /go home/i })).toBeVisible()

      // Not the segment error boundary. A crash rendered as a 404 would hide
      // real server-component failures from anyone reading the logs.
      await expectNoErrorBoundary(page)

      // And it is a real 404 on the wire, so crawlers and monitoring agree
      // with what the user sees.
      expect(response?.status()).toBe(404)
    })
  }
})
