/**
 * dual-app-dom-diff — boot v0 and tydei simultaneously, log in as the
 * same demo user in each, and for every matching route extract every
 * interactive element (tabs, buttons, tab labels, dialog titles, field
 * labels, headings) from BOTH, diff them, and report the gaps.
 *
 * This is a BEHAVIORAL diff, not a pixel diff. It answers "does tydei
 * expose the same feature set as v0?" which is the question my earlier
 * verification loop kept getting wrong.
 *
 * Usage:
 *   bun run scripts/dual-app-dom-diff.ts
 *   V0_URL=http://localhost:3111 TYDEI_URL=http://localhost:3000 bun run scripts/dual-app-dom-diff.ts
 *
 * Requires: both apps running. v0 at 3111, tydei at 3000 by default.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
import { mkdirSync, existsSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const V0_URL = process.env.V0_URL ?? "http://localhost:3111"
const TYDEI_URL = process.env.TYDEI_URL ?? "http://localhost:3000"
const OUT_DIR = resolve(import.meta.dir, "..", "docs", "dual-diff")

// Facility routes shared between v0 and tydei. The slug is the same on
// both sides; the path is how each app exposes it.
type RoutePair = {
  slug: string
  v0Path: string
  tydeiPath: string
}

const FACILITY_ROUTES: RoutePair[] = [
  { slug: "dashboard-home", v0Path: "/dashboard", tydeiPath: "/dashboard" },
  { slug: "dashboard-contracts", v0Path: "/dashboard/contracts", tydeiPath: "/dashboard/contracts" },
  { slug: "dashboard-contracts-new", v0Path: "/dashboard/contracts/new", tydeiPath: "/dashboard/contracts/new" },
  { slug: "dashboard-cog-data", v0Path: "/dashboard/cog-data", tydeiPath: "/dashboard/cog-data" },
  { slug: "dashboard-purchase-orders", v0Path: "/dashboard/purchase-orders", tydeiPath: "/dashboard/purchase-orders" },
  { slug: "dashboard-invoice-validation", v0Path: "/dashboard/invoice-validation", tydeiPath: "/dashboard/invoice-validation" },
  { slug: "dashboard-alerts", v0Path: "/dashboard/alerts", tydeiPath: "/dashboard/alerts" },
  { slug: "dashboard-reports", v0Path: "/dashboard/reports", tydeiPath: "/dashboard/reports" },
  { slug: "dashboard-case-costing", v0Path: "/dashboard/case-costing", tydeiPath: "/dashboard/case-costing" },
  { slug: "dashboard-analysis", v0Path: "/dashboard/analysis", tydeiPath: "/dashboard/analysis" },
  { slug: "dashboard-rebate-optimizer", v0Path: "/dashboard/rebate-optimizer", tydeiPath: "/dashboard/rebate-optimizer" },
  { slug: "dashboard-contract-renewals", v0Path: "/dashboard/contract-renewals", tydeiPath: "/dashboard/renewals" },
  { slug: "dashboard-ai-agent", v0Path: "/dashboard/ai-agent", tydeiPath: "/dashboard/ai-agent" },
  { slug: "dashboard-settings", v0Path: "/dashboard/settings", tydeiPath: "/dashboard/settings" },
]

const VENDOR_ROUTES: RoutePair[] = [
  { slug: "vendor-home", v0Path: "/vendor", tydeiPath: "/vendor/dashboard" },
  { slug: "vendor-contracts", v0Path: "/vendor/contracts", tydeiPath: "/vendor/contracts" },
  { slug: "vendor-contracts-new", v0Path: "/vendor/contracts/new", tydeiPath: "/vendor/contracts/new" },
  { slug: "vendor-invoices", v0Path: "/vendor/invoices", tydeiPath: "/vendor/invoices" },
  { slug: "vendor-purchase-orders", v0Path: "/vendor/purchase-orders", tydeiPath: "/vendor/purchase-orders" },
  { slug: "vendor-market-share", v0Path: "/vendor/market-share", tydeiPath: "/vendor/market-share" },
  { slug: "vendor-performance", v0Path: "/vendor/performance", tydeiPath: "/vendor/performance" },
  { slug: "vendor-prospective", v0Path: "/vendor/prospective", tydeiPath: "/vendor/prospective" },
  { slug: "vendor-alerts", v0Path: "/vendor/alerts", tydeiPath: "/vendor/alerts" },
  { slug: "vendor-ai-agent", v0Path: "/vendor/ai-agent", tydeiPath: "/vendor/ai-agent" },
  { slug: "vendor-reports", v0Path: "/vendor/reports", tydeiPath: "/vendor/reports" },
  { slug: "vendor-settings", v0Path: "/vendor/settings", tydeiPath: "/vendor/settings" },
]

type ExtractedElements = {
  tabs: string[]           // <TabsTrigger> text — the feature that keeps being deleted
  headings: string[]       // h1 / h2 / h3 text
  buttons: string[]        // visible <button> text
  dialogTitles: string[]   // <DialogTitle> if present (usually hidden)
  fieldLabels: string[]    // form labels
  cardTitles: string[]     // <CardTitle> text
  badgeText: string[]      // <Badge> text — status chips, counts
}

const EXTRACT_SCRIPT = `(() => {
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim()
  // Strip trailing/embedded digits so "Alerts5 new" and "Alerts3 new"
  // compare equal. Counts drive false positives and obscure the real
  // feature deltas we care about.
  const normalizeCounts = (s) =>
    s
      .replace(/\\b\\d{1,6}\\b/g, "N")   // any run of digits → N
      .replace(/\\s+/g, " ")
      .trim()
  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)))

  // Chrome/shell selectors to ignore. Both apps wrap pages in a shared
  // shell; we strip its buttons/headings so they don't appear in every
  // route diff. NB: tydei uses [data-slot='sidebar-wrapper'] as the app
  // root — that is NOT chrome, it contains page content — we only
  // exclude the sidebar itself, header, and nav elements.
  const isChrome = (el) => {
    // Header bar at top of each portal (search, notifications, user menu)
    if (el.closest("header")) return true
    // Sidebar nav rail
    if (el.closest('[data-slot="sidebar"]')) return true
    if (el.closest('[data-slot="sidebar-content"]')) return true
    if (el.closest('[data-slot="sidebar-header"]')) return true
    if (el.closest('[data-slot="sidebar-footer"]')) return true
    // v0 uses <aside> for the sidebar
    if (el.closest("aside")) return true
    // Nav lists — but ONLY if they're within a shell aside/header, not
    // the main content (some pages have in-page navs like tabs).
    const nav = el.closest("nav")
    if (nav && (nav.closest("aside") || nav.closest("header"))) return true
    return false
  }

  // Drop chrome-y literal strings regardless of where they appear.
  const CHROME_TEXT = new Set([
    "toggle sidebar",
    "global search",
    "notifications",
    "theme",
    "search",
    "import data",
    "mass upload",
    "menu",
    "previous",
    "next",
    "actions",
  ])
  const isChromeText = (t) => {
    const low = t.toLowerCase()
    if (CHROME_TEXT.has(low)) return true
    // Avatar-derived strings like "FDFacility Demodemo-facility@tydei.com"
    if (/demo-?(facility|vendor|admin)@tydei/i.test(low)) return true
    if (/@tydei\\.com/.test(low)) return true
    // Shortcut hint like "search …⌘K"
    if (/⌘|ctrl\\+/i.test(low)) return true
    return false
  }

  const tabs = uniq(
    Array.from(document.querySelectorAll('[role="tab"]'))
      .filter((el) => !isChrome(el))
      .map((el) => normalizeCounts(norm(el.textContent)))
      .filter((t) => t.length > 0 && !isChromeText(t))
  )

  const headings = uniq(
    Array.from(document.querySelectorAll("main h1, main h2, main h3, [role='main'] h1, [role='main'] h2, [role='main'] h3"))
      .filter((el) => !isChrome(el))
      .map((el) => normalizeCounts(norm(el.textContent)))
      .filter((t) => t.length > 0 && t.length < 120 && !isChromeText(t))
  )

  const buttons = uniq(
    Array.from(document.querySelectorAll("main button, main [role='button'], main a[role='button']"))
      .filter((el) => !isChrome(el))
      .map((el) => normalizeCounts(norm(el.textContent || el.getAttribute("aria-label") || "")))
      .filter((t) => t.length > 1 && t.length < 80 && !/^[<>×]$/.test(t) && !isChromeText(t))
  )

  const cardTitles = uniq(
    Array.from(document.querySelectorAll('main [data-slot="card-title"], main .card-title, main [class*="CardTitle"]'))
      .filter((el) => !isChrome(el))
      .map((el) => normalizeCounts(norm(el.textContent)))
      .filter((t) => t.length > 0 && t.length < 80 && !isChromeText(t))
  )

  const fieldLabels = uniq(
    Array.from(document.querySelectorAll("main label, main [data-slot='label']"))
      .filter((el) => !isChrome(el))
      .map((el) => norm(el.textContent))
      .filter((t) => t.length > 0 && t.length < 80 && !isChromeText(t))
  )

  const badgeText = uniq(
    Array.from(document.querySelectorAll('main [data-slot="badge"], main .badge, main [class*="Badge"]'))
      .filter((el) => !isChrome(el))
      .map((el) => normalizeCounts(norm(el.textContent)))
      .filter((t) => t.length > 0 && t.length < 40 && !isChromeText(t))
  )

  const dialogTitles = uniq(
    Array.from(document.querySelectorAll('[data-slot="dialog-title"], [role="dialog"] h2'))
      .map((el) => norm(el.textContent))
      .filter((t) => t.length > 0 && !isChromeText(t))
  )

  return { tabs, headings, buttons, dialogTitles, fieldLabels, cardTitles, badgeText }
})()`

async function loginV0(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([
    {
      name: "demo_session",
      value: "true",
      url: V0_URL,
    },
  ])
  return ctx
}

async function tydeiSignIn(
  browser: Browser,
  email: string,
  password: string,
): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(TYDEI_URL, { waitUntil: "domcontentloaded", timeout: 30_000 })
  // Run fetch inside the page so the browser sets the session cookie
  // naturally — avoids playwright's apiRequest Set-Cookie URL parsing
  // quirk that rejects same-origin relative Path cookies.
  const result = await page.evaluate(
    async ({ email, password }) => {
      const r = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      })
      return { ok: r.ok, status: r.status }
    },
    { email, password },
  )
  if (!result.ok) {
    throw new Error(`tydei ${email} login failed: ${result.status}`)
  }
  await page.close()
  return ctx
}

async function loginTydei(browser: Browser): Promise<BrowserContext> {
  return tydeiSignIn(browser, "demo-facility@tydei.com", "demo-facility-2024")
}

async function loginTydeiVendor(browser: Browser): Promise<BrowserContext> {
  return tydeiSignIn(browser, "demo-vendor@tydei.com", "demo-vendor-2024")
}

async function extract(
  page: Page,
  url: string,
  label: string,
): Promise<ExtractedElements | null> {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 })
  } catch {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
    } catch (err) {
      console.error(`  [fail] ${label} ${url}: ${(err as Error).message}`)
      return null
    }
  }
  // Let client-side hydration finish.
  await page.waitForTimeout(1200)
  try {
    return (await page.evaluate(EXTRACT_SCRIPT)) as ExtractedElements
  } catch (err) {
    console.error(`  [extract fail] ${label} ${url}: ${(err as Error).message}`)
    return null
  }
}

function diffLists(v0List: string[], tydeiList: string[]): { missing: string[]; extra: string[] } {
  const v0Set = new Set(v0List.map((s) => s.toLowerCase()))
  const tydeiSet = new Set(tydeiList.map((s) => s.toLowerCase()))
  const missing: string[] = []
  const extra: string[] = []
  for (const item of v0List) {
    if (!tydeiSet.has(item.toLowerCase())) missing.push(item)
  }
  for (const item of tydeiList) {
    if (!v0Set.has(item.toLowerCase())) extra.push(item)
  }
  return { missing, extra }
}

type RouteDiff = {
  slug: string
  v0Path: string
  tydeiPath: string
  present: { v0: boolean; tydei: boolean }
  tabs?: { missing: string[]; extra: string[] }
  headings?: { missing: string[]; extra: string[] }
  buttons?: { missing: string[]; extra: string[] }
  cardTitles?: { missing: string[]; extra: string[] }
  fieldLabels?: { missing: string[]; extra: string[] }
}

async function runDiffSet(
  label: "facility" | "vendor",
  routes: RoutePair[],
  browser: Browser,
  v0Ctx: BrowserContext,
  tydeiCtx: BrowserContext,
): Promise<RouteDiff[]> {
  const results: RouteDiff[] = []
  const v0Page = await v0Ctx.newPage()
  const tydeiPage = await tydeiCtx.newPage()

  for (const route of routes) {
    console.log(`  ${label}/${route.slug}`)
    const [v0Els, tydeiEls] = await Promise.all([
      extract(v0Page, `${V0_URL}${route.v0Path}`, `v0:${route.slug}`),
      extract(tydeiPage, `${TYDEI_URL}${route.tydeiPath}`, `tydei:${route.slug}`),
    ])

    const diff: RouteDiff = {
      slug: route.slug,
      v0Path: route.v0Path,
      tydeiPath: route.tydeiPath,
      present: { v0: !!v0Els, tydei: !!tydeiEls },
    }

    if (v0Els && tydeiEls) {
      diff.tabs = diffLists(v0Els.tabs, tydeiEls.tabs)
      diff.headings = diffLists(v0Els.headings, tydeiEls.headings)
      diff.buttons = diffLists(v0Els.buttons, tydeiEls.buttons)
      diff.cardTitles = diffLists(v0Els.cardTitles, tydeiEls.cardTitles)
      diff.fieldLabels = diffLists(v0Els.fieldLabels, tydeiEls.fieldLabels)
    }

    results.push(diff)
  }

  await v0Page.close()
  await tydeiPage.close()
  return results
}

function hasAnyDelta(d: RouteDiff): boolean {
  return (
    !d.present.v0 ||
    !d.present.tydei ||
    !!d.tabs?.missing.length ||
    !!d.tabs?.extra.length ||
    !!d.buttons?.missing.length ||
    !!d.cardTitles?.missing.length ||
    !!d.headings?.missing.length ||
    !!d.fieldLabels?.missing.length
  )
}

function formatDiffSection(
  label: string,
  diff: { missing: string[]; extra: string[] } | undefined,
): string {
  if (!diff) return ""
  if (diff.missing.length === 0 && diff.extra.length === 0) return ""
  const lines: string[] = [`    **${label}:**`]
  if (diff.missing.length > 0) {
    lines.push(`      _tydei missing:_ ${diff.missing.map((s) => `\`${s}\``).join(", ")}`)
  }
  if (diff.extra.length > 0) {
    lines.push(`      _tydei extra:_ ${diff.extra.map((s) => `\`${s}\``).join(", ")}`)
  }
  return lines.join("\n")
}

function formatReport(
  results: RouteDiff[],
  title: string,
): string {
  const lines: string[] = [`## ${title}`]
  const withDeltas = results.filter(hasAnyDelta)
  if (withDeltas.length === 0) {
    lines.push("_Clean — every route matches v0's feature set._\n")
    return lines.join("\n")
  }
  for (const d of withDeltas) {
    lines.push(`\n### ${d.slug}`)
    lines.push(`_v0: \`${d.v0Path}\` · tydei: \`${d.tydeiPath}\`_`)
    if (!d.present.v0) lines.push("  - ⚠️ **v0 page failed to load**")
    if (!d.present.tydei) lines.push("  - ⚠️ **tydei page failed to load**")
    const tabSec = formatDiffSection("Tabs", d.tabs)
    const btnSec = formatDiffSection("Buttons", d.buttons)
    const cardSec = formatDiffSection("Card Titles", d.cardTitles)
    const hSec = formatDiffSection("Headings", d.headings)
    const labelSec = formatDiffSection("Field Labels", d.fieldLabels)
    for (const s of [tabSec, btnSec, cardSec, hSec, labelSec]) {
      if (s) lines.push(s)
    }
  }
  return lines.join("\n")
}

async function main() {
  console.log(`dual-app-dom-diff — comparing\n  v0:    ${V0_URL}\n  tydei: ${TYDEI_URL}\n`)
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })

  let facilityResults: RouteDiff[] = []
  let vendorResults: RouteDiff[] = []

  try {
    console.log("logging in as facility on both apps…")
    const v0Ctx = await loginV0(browser)
    const tydeiCtx = await loginTydei(browser)

    console.log("\nfacility routes:")
    facilityResults = await runDiffSet("facility", FACILITY_ROUTES, browser, v0Ctx, tydeiCtx)

    await v0Ctx.close()
    await tydeiCtx.close()

    console.log("\nlogging in as vendor on both apps…")
    const v0VendorCtx = await loginV0(browser)
    const tydeiVendorCtx = await loginTydeiVendor(browser)

    console.log("\nvendor routes:")
    vendorResults = await runDiffSet("vendor", VENDOR_ROUTES, browser, v0VendorCtx, tydeiVendorCtx)

    await v0VendorCtx.close()
    await tydeiVendorCtx.close()
  } finally {
    await browser.close()
  }

  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-")
  const reportPath = resolve(OUT_DIR, `${ts}.md`)
  const body = [
    `# Dual-app DOM diff — ${ts}`,
    ``,
    `Compares v0 (${V0_URL}) vs tydei (${TYDEI_URL}) at the feature level:`,
    `tabs, buttons, card titles, headings, field labels. Structural only —`,
    `data differences are expected and ignored.`,
    ``,
    formatReport(facilityResults, "Facility Portal"),
    ``,
    formatReport(vendorResults, "Vendor Portal"),
    ``,
  ].join("\n")

  writeFileSync(reportPath, body)
  console.log(`\nreport → ${reportPath}`)

  const totalDeltas =
    facilityResults.filter(hasAnyDelta).length +
    vendorResults.filter(hasAnyDelta).length
  const totalRoutes = facilityResults.length + vendorResults.length
  console.log(`\n${totalRoutes - totalDeltas}/${totalRoutes} routes clean · ${totalDeltas} routes with deltas`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
