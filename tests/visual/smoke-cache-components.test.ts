import { test, expect, type Page } from "@playwright/test"
import { prisma } from "@/lib/db"

/**
 * Cache Components rollout — full route compatibility smoke.
 *
 * Per docs/superpowers/plans/2026-04-26-cache-components-rollout.md
 * tasks 5 + 6, expanded to 100% page-route coverage. Hits every
 * page.tsx in app/ and asserts a < 500 status + no "Application
 * error" overlay. Catches the class of regression where enabling
 * `cacheComponents: true` would break a route that was relying on
 * default static behavior.
 *
 * Dynamic [id] routes are resolved from a beforeAll Prisma query so
 * the route list reflects real seed data. When seeded data isn't
 * available for a dynamic route (e.g., bundles in an empty seed),
 * the test is skipped with a clear message rather than failing.
 *
 * Uses the in-test login helper pattern because the storageState
 * fixtures in tests/visual/.auth/ have a known cookie-jar bug —
 * request.post stores cookies in the API context, not the page
 * context, so saved state.json files have empty cookies.
 */

// ─── Login + smoke helpers ─────────────────────────────────────

const CREDS = {
  facility: ["demo-facility@tydei.com", "demo-facility-2024", /\/dashboard/],
  vendor: ["demo-vendor@tydei.com", "demo-vendor-2024", /\/vendor/],
  admin: ["demo-admin@tydei.com", "demo-admin-2024", /\/admin/],
} as const

type Role = keyof typeof CREDS

async function loginAs(page: Page, role: Role): Promise<void> {
  const [email, password, expectedUrl] = CREDS[role]
  await page.goto("/login")
  await page.getByPlaceholder(/email/i).fill(email)
  await page.getByPlaceholder(/password/i).fill(password)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(expectedUrl, { timeout: 15_000 })
}

async function smoke(page: Page, route: string): Promise<void> {
  const response = await page.goto(route, { timeout: 30_000 })
  // < 500 covers 200/3xx/4xx (4xx is fine for missing-id 404s; we
  // only care that the route doesn't crash the server).
  expect(response?.status()).toBeLessThan(500)
  const overlayCount = await page.locator("text=Application error").count()
  expect(overlayCount).toBe(0)
}

// ─── Dynamic-id resolver (runs once before the test file) ───────

interface DynamicIds {
  facility: {
    contractId: string | null
    bundleId: string | null
    alertId: string | null
    invoiceId: string | null
    purchaseOrderId: string | null
  }
  vendor: {
    contractId: string | null
    pendingContractId: string | null
  }
}

const ids: DynamicIds = {
  facility: {
    contractId: null,
    bundleId: null,
    alertId: null,
    invoiceId: null,
    purchaseOrderId: null,
  },
  vendor: {
    contractId: null,
    pendingContractId: null,
  },
}

test.beforeAll(async () => {
  const lighthouse = await prisma.facility.findFirst({
    where: { name: "Lighthouse Surgical Center" },
    select: { id: true },
  })
  const stryker = await prisma.vendor.findFirst({
    where: { name: "Stryker" },
    select: { id: true },
  })

  if (lighthouse) {
    const [contract, bundle, alert, invoice, po] = await Promise.all([
      prisma.contract.findFirst({
        where: { facilityId: lighthouse.id },
        select: { id: true },
      }),
      // TieInBundle is keyed by primaryContractId (1:1 with the
      // primary tie-in contract); no direct facilityId column. Query
      // via the contract relation so we only pick a bundle owned by
      // this facility.
      prisma.tieInBundle
        .findFirst({
          where: { primaryContract: { facilityId: lighthouse.id } },
          select: { id: true },
        })
        .catch(() => null),
      prisma.alert.findFirst({
        where: { facilityId: lighthouse.id },
        select: { id: true },
      }),
      prisma.invoice.findFirst({
        where: { facilityId: lighthouse.id },
        select: { id: true },
      }),
      prisma.purchaseOrder.findFirst({
        where: { facilityId: lighthouse.id },
        select: { id: true },
      }),
    ])
    ids.facility.contractId = contract?.id ?? null
    ids.facility.bundleId = bundle?.id ?? null
    ids.facility.alertId = alert?.id ?? null
    ids.facility.invoiceId = invoice?.id ?? null
    ids.facility.purchaseOrderId = po?.id ?? null
  }

  if (stryker) {
    const [contract, pending] = await Promise.all([
      prisma.contract.findFirst({
        where: { vendorId: stryker.id },
        select: { id: true },
      }),
      prisma.pendingContract.findFirst({
        where: { vendorId: stryker.id },
        select: { id: true },
      }),
    ])
    ids.vendor.contractId = contract?.id ?? null
    ids.vendor.pendingContractId = pending?.id ?? null
  }
})

test.afterAll(async () => {
  await prisma.$disconnect()
})

// ─── Public / unauthenticated routes ───────────────────────────

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/sign-up",
  "/sign-up-success",
  "/forgot-password",
  "/reset-password",
  "/error",
]

test.describe("public routes (no auth)", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`public ${route} renders without 500`, async ({ page }) => {
      await smoke(page, route)
    })
  }
})

// ─── Facility routes ──────────────────────────────────────────

const FACILITY_STATIC = [
  "/dashboard",
  "/dashboard/ai-agent",
  "/dashboard/alerts",
  "/dashboard/analysis",
  "/dashboard/analysis/prospective",
  "/dashboard/case-costing",
  "/dashboard/case-costing/compare",
  "/dashboard/case-costing/reports",
  "/dashboard/cog-data",
  "/dashboard/contracts",
  "/dashboard/contracts/new",
  "/dashboard/contracts/bundles",
  "/dashboard/contracts/bundles/new",
  "/dashboard/invoice-validation",
  "/dashboard/purchase-orders",
  "/dashboard/purchase-orders/new",
  "/dashboard/rebate-optimizer",
  "/dashboard/renewals",
  "/dashboard/reports",
  "/dashboard/reports/compliance",
  "/dashboard/reports/price-discrepancy",
  "/dashboard/settings",
]

test.describe("facility static routes", () => {
  for (const route of FACILITY_STATIC) {
    test(`facility ${route} renders without 500`, async ({ page }) => {
      await loginAs(page, "facility")
      await smoke(page, route)
    })
  }
})

test.describe("facility dynamic routes", () => {
  test("contract detail [id]", async ({ page }) => {
    if (!ids.facility.contractId) test.skip(true, "no facility contract in seed")
    await loginAs(page, "facility")
    await smoke(page, `/dashboard/contracts/${ids.facility.contractId}`)
  })
  test("contract edit [id]/edit", async ({ page }) => {
    if (!ids.facility.contractId) test.skip(true, "no facility contract in seed")
    await loginAs(page, "facility")
    await smoke(page, `/dashboard/contracts/${ids.facility.contractId}/edit`)
  })
  test("contract terms [id]/terms", async ({ page }) => {
    if (!ids.facility.contractId) test.skip(true, "no facility contract in seed")
    await loginAs(page, "facility")
    await smoke(page, `/dashboard/contracts/${ids.facility.contractId}/terms`)
  })
  test("bundle detail [id]", async ({ page }) => {
    if (!ids.facility.bundleId) test.skip(true, "no bundle in seed")
    await loginAs(page, "facility")
    await smoke(page, `/dashboard/contracts/bundles/${ids.facility.bundleId}`)
  })
  test("bundle edit [id]/edit", async ({ page }) => {
    if (!ids.facility.bundleId) test.skip(true, "no bundle in seed")
    await loginAs(page, "facility")
    await smoke(page, `/dashboard/contracts/bundles/${ids.facility.bundleId}/edit`)
  })
  test("alert detail [id]", async ({ page }) => {
    if (!ids.facility.alertId) test.skip(true, "no alert in seed")
    await loginAs(page, "facility")
    await smoke(page, `/dashboard/alerts/${ids.facility.alertId}`)
  })
  test("invoice validation [id]", async ({ page }) => {
    if (!ids.facility.invoiceId) test.skip(true, "no invoice in seed")
    await loginAs(page, "facility")
    await smoke(page, `/dashboard/invoice-validation/${ids.facility.invoiceId}`)
  })
  test("purchase order detail [id]", async ({ page }) => {
    if (!ids.facility.purchaseOrderId) test.skip(true, "no PO in seed")
    await loginAs(page, "facility")
    await smoke(page, `/dashboard/purchase-orders/${ids.facility.purchaseOrderId}`)
  })
})

// ─── Vendor routes ────────────────────────────────────────────

const VENDOR_STATIC = [
  "/vendor",
  "/vendor/ai-agent",
  "/vendor/alerts",
  "/vendor/contracts",
  "/vendor/contracts/new",
  "/vendor/dashboard",
  "/vendor/invoices",
  "/vendor/market-share",
  "/vendor/performance",
  "/vendor/prospective",
  "/vendor/purchase-orders",
  "/vendor/renewals",
  "/vendor/reports",
  "/vendor/settings",
]

test.describe("vendor static routes", () => {
  for (const route of VENDOR_STATIC) {
    test(`vendor ${route} renders without 500`, async ({ page }) => {
      await loginAs(page, "vendor")
      await smoke(page, route)
    })
  }
})

test.describe("vendor dynamic routes", () => {
  test("vendor contract detail [id]", async ({ page }) => {
    if (!ids.vendor.contractId) test.skip(true, "no vendor contract in seed")
    await loginAs(page, "vendor")
    await smoke(page, `/vendor/contracts/${ids.vendor.contractId}`)
  })
  test("vendor contract edit [id]/edit", async ({ page }) => {
    if (!ids.vendor.contractId) test.skip(true, "no vendor contract in seed")
    await loginAs(page, "vendor")
    await smoke(page, `/vendor/contracts/${ids.vendor.contractId}/edit`)
  })
  test("vendor pending-contract edit [id]/edit", async ({ page }) => {
    if (!ids.vendor.pendingContractId) test.skip(true, "no pending contract in seed")
    await loginAs(page, "vendor")
    await smoke(page, `/vendor/contracts/pending/${ids.vendor.pendingContractId}/edit`)
  })
})

// ─── Admin routes ─────────────────────────────────────────────

const ADMIN_ROUTES = [
  "/admin",
  "/admin/billing",
  "/admin/dashboard",
  "/admin/facilities",
  "/admin/payor-contracts",
  "/admin/users",
  "/admin/vendors",
]

test.describe("admin routes", () => {
  for (const route of ADMIN_ROUTES) {
    test(`admin ${route} renders without 500`, async ({ page }) => {
      await loginAs(page, "admin")
      await smoke(page, route)
    })
  }
})
