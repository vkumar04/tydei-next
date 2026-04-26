import { test, expect, type Page } from "@playwright/test"

/**
 * Cache Components rollout — route compatibility smoke.
 *
 * Per docs/superpowers/plans/2026-04-26-cache-components-rollout.md
 * tasks 5 + 6. Hits every top-level facility / vendor / admin route
 * and asserts a < 500 status + no "Application error" overlay. Catches
 * the class of regression where enabling `cacheComponents: true` would
 * break a route that was relying on default static behavior.
 *
 * Uses the in-test login helper pattern (mirrors vendor-pages.test.ts)
 * because the storageState fixtures in tests/visual/.auth/ have a known
 * cookie-jar bug — request.post stores cookies in the API context, not
 * the page context, so saved state.json files have empty cookies.
 */

async function loginAs(
  page: Page,
  role: "facility" | "vendor" | "admin",
): Promise<void> {
  const creds = {
    facility: ["demo-facility@tydei.com", "demo-facility-2024", /\/dashboard/],
    vendor: ["demo-vendor@tydei.com", "demo-vendor-2024", /\/vendor/],
    admin: ["demo-admin@tydei.com", "demo-admin-2024", /\/admin/],
  } as const
  const [email, password, expectedUrl] = creds[role]
  await page.goto("/login")
  await page.getByPlaceholder(/email/i).fill(email)
  await page.getByPlaceholder(/password/i).fill(password)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(expectedUrl, { timeout: 15_000 })
}

async function smoke(page: Page, route: string): Promise<void> {
  const response = await page.goto(route, { timeout: 30_000 })
  expect(response?.status()).toBeLessThan(500)
  // The dev-error overlay text. Production renders a generic 500
  // page; either way, this string indicates a runtime failure.
  const overlayCount = await page.locator("text=Application error").count()
  expect(overlayCount).toBe(0)
}

// ─── Facility ──────────────────────────────────────────────────

const FACILITY_ROUTES = [
  "/dashboard",
  "/dashboard/contracts",
  "/dashboard/renewals",
  "/dashboard/reports",
  "/dashboard/case-costing",
  "/dashboard/cog-data",
  "/dashboard/rebate-optimizer",
  "/dashboard/alerts",
  "/dashboard/analysis",
  "/dashboard/ai-agent",
  "/dashboard/settings",
  "/dashboard/purchase-orders",
  "/dashboard/invoice-validation",
]

test.describe("facility cacheComponents smoke", () => {
  for (const route of FACILITY_ROUTES) {
    test(`facility ${route} renders without 500`, async ({ page }) => {
      await loginAs(page, "facility")
      await smoke(page, route)
    })
  }
})

// ─── Vendor ────────────────────────────────────────────────────

const VENDOR_ROUTES = [
  "/vendor",
  "/vendor/dashboard",
  "/vendor/contracts",
  "/vendor/invoices",
  "/vendor/purchase-orders",
  "/vendor/alerts",
  "/vendor/market-share",
  "/vendor/performance",
  "/vendor/renewals",
  "/vendor/reports",
  "/vendor/ai-agent",
  "/vendor/settings",
  "/vendor/prospective",
]

test.describe("vendor cacheComponents smoke", () => {
  for (const route of VENDOR_ROUTES) {
    test(`vendor ${route} renders without 500`, async ({ page }) => {
      await loginAs(page, "vendor")
      await smoke(page, route)
    })
  }
})

// ─── Admin ─────────────────────────────────────────────────────

const ADMIN_ROUTES = [
  "/admin",
  "/admin/dashboard",
  "/admin/users",
  "/admin/facilities",
  "/admin/vendors",
  "/admin/payor-contracts",
  "/admin/billing",
]

test.describe("admin cacheComponents smoke", () => {
  for (const route of ADMIN_ROUTES) {
    test(`admin ${route} renders without 500`, async ({ page }) => {
      await loginAs(page, "admin")
      await smoke(page, route)
    })
  }
})
