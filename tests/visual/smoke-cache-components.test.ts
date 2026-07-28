import {
  test,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import { Client } from "pg"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * 2026-07-27: this used to `import { prisma } from "@/lib/db"` to resolve the
 * seeded ids below. That import took the WHOLE visual project down — Prisma 7's
 * `prisma-client` generator emits `import.meta` in lib/generated/prisma/client.ts,
 * which Playwright's node loader cannot parse from a CJS context:
 *
 *   SyntaxError: Cannot use 'import.meta' outside a module   at lib/db.ts:2
 *
 * That is a collection-time error, so all four visual specs failed to load and
 * the entire project had been silently dead since the Prisma 7 migration.
 *
 * A Playwright spec has no business importing the app's server-only DB client
 * anyway; it only needs a handful of ids. Query them over plain `pg` (already a
 * dependency — PrismaPg is built on it) and the coupling disappears.
 */
/**
 * Playwright does NOT load .env (unlike vitest, which does it via
 * tests/setup.ts). Read it explicitly rather than letting `pg` fall back to its
 * defaults — an undefined connection string resolves to localhost:5432, which
 * on a dev machine is very likely a DIFFERENT project's database. Failing loudly
 * beats silently asserting against the wrong data.
 */
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = path.resolve(process.cwd(), ".env")
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.trimStart().startsWith("DATABASE_URL="))
  const value = line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")
  if (!value) {
    throw new Error(
      `DATABASE_URL is not set and could not be read from ${envPath} — the visual smoke needs it to resolve seeded ids.`,
    )
  }
  return value
}

async function lookupIds(): Promise<Record<string, string | null>> {
  const client = new Client({ connectionString: databaseUrl() })
  await client.connect()
  try {
    const one = async (sql: string, params: unknown[] = []) => {
      const r = await client.query(sql, params)
      return (r.rows[0]?.id as string | undefined) ?? null
    }
    const facilityId = await one(
      `select id from facility where name = $1 limit 1`,
      ["Lighthouse Surgical Center"],
    )
    const vendorId = await one(`select id from vendor where name = $1 limit 1`, [
      "Stryker",
    ])
    return {
      facilityContractId: facilityId
        ? await one(`select id from contract where "facilityId" = $1 limit 1`, [facilityId])
        : null,
      // tie_in_bundle is keyed by primaryContractId (1:1 with the primary tie-in
      // contract); no direct facilityId column — join through contract so we only
      // pick a bundle owned by this facility.
      bundleId: facilityId
        ? await one(
            `select b.id from tie_in_bundle b
               join contract c on c.id = b."primaryContractId"
              where c."facilityId" = $1 limit 1`,
            [facilityId],
          )
        : null,
      alertId: facilityId
        ? await one(`select id from alert where "facilityId" = $1 limit 1`, [facilityId])
        : null,
      invoiceId: facilityId
        ? await one(`select id from invoice where "facilityId" = $1 limit 1`, [facilityId])
        : null,
      purchaseOrderId: facilityId
        ? await one(`select id from purchase_order where "facilityId" = $1 limit 1`, [facilityId])
        : null,
      vendorContractId: vendorId
        ? await one(`select id from contract where "vendorId" = $1 limit 1`, [vendorId])
        : null,
      vendorPendingContractId: vendorId
        ? await one(`select id from pending_contract where "vendorId" = $1 limit 1`, [vendorId])
        : null,
    }
  } finally {
    await client.end()
  }
}

/**
 * Cache Components rollout — full route compatibility smoke.
 *
 * tasks 5 + 6, expanded to 100% page-route coverage. Hits every
 * page.tsx in app/ and asserts a < 500 status + no "Application
 * error" overlay. Catches the class of regression where enabling
 * `cacheComponents: true` would break a route that was relying on
 * default static behavior.
 *
 * Dynamic [id] routes are resolved in `beforeAll` from `lookupIds()`
 * above — plain `pg`, NOT Prisma; see the header note for why the
 * Prisma import had to go. When seeded data isn't available for a
 * dynamic route the test is skipped with a clear message rather than
 * failing. On the current dev seed that is three: both bundle routes
 * (no tie_in_bundle under Lighthouse Surgical Center) and the vendor
 * pending-contract edit (Stryker has no PendingContract rows).
 *
 * Uses an in-test login helper rather than a storageState fixture
 * because this file needs all three roles and tests/visual/auth.setup.ts
 * only saves the facility one. (The comment that used to sit here said
 * the .auth/ states were unusable because of a request.post cookie-jar
 * bug — that was fixed on 2026-07-27 when auth.setup.ts switched to a
 * browser login; the other specs in this directory use its state.json.)
 * See `loginAs` below for why it logs in once per role, not once per test.
 */

// ─── Login + smoke helpers ─────────────────────────────────────

const CREDS = {
  facility: ["demo-facility@tydei.com", "demo-facility-2024", /\/dashboard/],
  vendor: ["demo-vendor@tydei.com", "demo-vendor-2024", /\/vendor/],
  admin: ["demo-admin@tydei.com", "demo-admin-2024", /\/admin/],
} as const

type Role = keyof typeof CREDS

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>

/**
 * One real browser login per role per worker; every later test in the file
 * replays that role's cookies into its own fresh context.
 *
 * 2026-07-28: this file used to log in once per test — ~54 sign-ins in a
 * six-minute serial run. better-auth caps /sign-in/email at 10 per 60s per
 * IP (lib/auth-server.ts `rateLimit.customRules`, added in the 2026-06-18
 * pre-prod audit), so runs of this project were dotted with 429s that
 * surfaced as `waitForURL` timeouts — seven of them in the last full run,
 * on routes that render perfectly well. The limiter is correct; the spec
 * was DOSing it.
 */
const sessions = new Map<Role, Cookies>()

async function loginAs(
  page: Page,
  context: BrowserContext,
  role: Role,
): Promise<void> {
  const cached = sessions.get(role)
  if (cached) {
    await context.addCookies(cached)
    return
  }
  const [email, password, expectedUrl] = CREDS[role]
  await page.goto("/login")
  // 2026-07-27: was getByPlaceholder(/email/i), which never matched — the
  // placeholder is "you@example.com". The <Label> is the stable selector, same
  // as tests/e2e/auth.setup.ts.
  await page.getByLabel(/^email$/i).fill(email)
  await page.getByLabel(/^password$/i).fill(password)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(expectedUrl, { timeout: 15_000 })
  sessions.set(role, await context.cookies())
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
  const found = await lookupIds()
  ids.facility.contractId = found.facilityContractId
  ids.facility.bundleId = found.bundleId
  ids.facility.alertId = found.alertId
  ids.facility.invoiceId = found.invoiceId
  ids.facility.purchaseOrderId = found.purchaseOrderId
  ids.vendor.contractId = found.vendorContractId
  ids.vendor.pendingContractId = found.vendorPendingContractId
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
    test(`facility ${route} renders without 500`, async ({ page, context }) => {
      await loginAs(page, context, "facility")
      await smoke(page, route)
    })
  }
})

test.describe("facility dynamic routes", () => {
  test("contract detail [id]", async ({ page, context }) => {
    if (!ids.facility.contractId) test.skip(true, "no facility contract in seed")
    await loginAs(page, context, "facility")
    await smoke(page, `/dashboard/contracts/${ids.facility.contractId}`)
  })
  test("contract edit [id]/edit", async ({ page, context }) => {
    if (!ids.facility.contractId) test.skip(true, "no facility contract in seed")
    await loginAs(page, context, "facility")
    await smoke(page, `/dashboard/contracts/${ids.facility.contractId}/edit`)
  })
  test("contract terms [id]/terms", async ({ page, context }) => {
    if (!ids.facility.contractId) test.skip(true, "no facility contract in seed")
    await loginAs(page, context, "facility")
    await smoke(page, `/dashboard/contracts/${ids.facility.contractId}/terms`)
  })
  test("bundle detail [id]", async ({ page, context }) => {
    if (!ids.facility.bundleId) test.skip(true, "no bundle in seed")
    await loginAs(page, context, "facility")
    await smoke(page, `/dashboard/contracts/bundles/${ids.facility.bundleId}`)
  })
  test("bundle edit [id]/edit", async ({ page, context }) => {
    if (!ids.facility.bundleId) test.skip(true, "no bundle in seed")
    await loginAs(page, context, "facility")
    await smoke(page, `/dashboard/contracts/bundles/${ids.facility.bundleId}/edit`)
  })
  test("alert detail [id]", async ({ page, context }) => {
    if (!ids.facility.alertId) test.skip(true, "no alert in seed")
    await loginAs(page, context, "facility")
    await smoke(page, `/dashboard/alerts/${ids.facility.alertId}`)
  })
  test("invoice validation [id]", async ({ page, context }) => {
    if (!ids.facility.invoiceId) test.skip(true, "no invoice in seed")
    await loginAs(page, context, "facility")
    await smoke(page, `/dashboard/invoice-validation/${ids.facility.invoiceId}`)
  })
  test("purchase order detail [id]", async ({ page, context }) => {
    if (!ids.facility.purchaseOrderId) test.skip(true, "no PO in seed")
    await loginAs(page, context, "facility")
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
    test(`vendor ${route} renders without 500`, async ({ page, context }) => {
      await loginAs(page, context, "vendor")
      await smoke(page, route)
    })
  }
})

test.describe("vendor dynamic routes", () => {
  test("vendor contract detail [id]", async ({ page, context }) => {
    if (!ids.vendor.contractId) test.skip(true, "no vendor contract in seed")
    await loginAs(page, context, "vendor")
    await smoke(page, `/vendor/contracts/${ids.vendor.contractId}`)
  })
  test("vendor contract edit [id]/edit", async ({ page, context }) => {
    if (!ids.vendor.contractId) test.skip(true, "no vendor contract in seed")
    await loginAs(page, context, "vendor")
    await smoke(page, `/vendor/contracts/${ids.vendor.contractId}/edit`)
  })
  test("vendor pending-contract edit [id]/edit", async ({ page, context }) => {
    if (!ids.vendor.pendingContractId) test.skip(true, "no pending contract in seed")
    await loginAs(page, context, "vendor")
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
    test(`admin ${route} renders without 500`, async ({ page, context }) => {
      await loginAs(page, context, "admin")
      await smoke(page, route)
    })
  }
})
