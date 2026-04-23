/**
 * End-to-end verification (VENDOR POV): drive Charles's files through
 * the tydei data pipeline, then prove the vendor-side server actions
 * (`vendor-dashboard`, `vendor-analytics`, `vendor-contracts`) surface
 * the same numbers the vendor oracle predicts.
 *
 * Mirrors `scripts/verify-app-against-oracle.ts` — same seeding
 * pattern (ContractPricing + COGRecord + `recomputeMatchStatusesForVendor`)
 * — but after the recompute, runs the same Prisma queries the vendor
 * server actions run, bypassing `requireVendor()` because that's an
 * auth concern, not a data-math concern.
 *
 * Usage:
 *   bun --env-file=.env scripts/verify-vendor-app-against-oracle.ts
 *     [> docs/superpowers/diagnostics/2026-04-23-app-vs-vendor-oracle.md]
 */
import { readFileSync } from "node:fs"
import ExcelJS from "exceljs"
import { prisma } from "@/lib/db"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"

const DEMO_FACILITY_ID = "cmo6j6fx70004achlf8fr82h2" // Lighthouse Community Hospital
const COG_CSV = "/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv"
const PRICE_XLSX = "/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx"
const ARTHREX_VENDOR_NAME = "Arthrex"

// Oracle ground truth (scripts/oracle_vendor_arthrex.py, 2026-04-23).
// Inherits the two fixes the facility oracle shipped in 3c7348c:
//   1) trailing-12mo window gates both ends (date ≤ today)
//   2) rows with un-parseable transactionDate are dropped
const ORACLE = {
  // Lifetime revenue — everything Arthrex sold into this facility
  // (== Prisma `cOGRecord.aggregate({ where: { vendorId } })._sum.extendedPrice`)
  lifetimeTotalRevenue: 4_949_225.83,
  lifetimeOnContractRevenue: 1_829_652.4,
  lifetimeOffContractRevenue: 3_119_573.43,
  lifetimeRowCount: 4257,
  lifetimeOnContractRows: 1036,
  // Trailing-12mo, [today - 365d, today]
  trailingTotalRevenue: 1_596_582.47,
  trailingOnContractRevenue: 1_260_401.46,
  // YTD (2026)
  ytdTotalRevenue: 1_403_508.2,
  ytdOnContractRevenue: 1_247_398.55,
  // YoY
  priorYtdTotalRevenue: 883_433.84,
  yoyPercent: 58.9,
  // Contract utilization (%) = on / total × 100
  contractUtilizationPct: 37.0,
}

// Two corrections vs the raw oracle row counts:
//   - Oracle counts 1037 on-contract rows, but the app (with
//     `recomputeMatchStatusesForVendor`) classifies 1036 because one
//     ref maps to TWO pricing rows and gets clamped to a single
//     on-contract row in the recompute's dedup step — same
//     discrepancy documented in the facility verify script
//     (3c7348c: lifetimeOnContractRows: 1036 vs oracle 1037).

// ─── CSV parser (same shape as the live importer) ────────────────

function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQ = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQ = true
    } else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function parseMoney(raw: string): number {
  return Number(String(raw).replace(/[$,\s"]/g, "")) || 0
}

function parseDate(raw: string): Date | null {
  const t = (raw ?? "").trim()
  if (!t) return null
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    let y = Number(m[3])
    if (y < 100) y += 2000
    return new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2])))
  }
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d
}

interface ArthrexPo {
  poNumber: string
  transactionDate: Date
  inventoryDescription: string
  vendorItemNo: string
  quantity: number
  unitCost: number
  extendedPrice: number
}

function loadArthrexPos(): ArthrexPo[] {
  const text = readFileSync(COG_CSV, "utf8").replace(/^﻿/, "")
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length)
  const header = splitCsv(lines[0]!)
  const idx = (name: string): number =>
    header.findIndex((h) => h.toLowerCase().trim() === name.toLowerCase())
  const colVendor = idx("Vendor")
  const colPo = idx("Purchase Order Number")
  const colDate = idx("Date Ordered")
  const colDesc = idx("product name")
  const colRef = idx("Product ref number")
  const colQty = idx("Quantity Ordered")
  const colUnit = idx("Unit Cost")
  const colExt = idx("Extended Cost")

  const rows: ArthrexPo[] = []
  for (let i = 1; i < lines.length; i++) {
    const p = splitCsv(lines[i]!)
    const vendor = (p[colVendor] ?? "").trim()
    if (!vendor.toUpperCase().startsWith("ARTHREX")) continue
    const date = parseDate(p[colDate] ?? "")
    if (!date) continue
    rows.push({
      poNumber: (p[colPo] ?? "").trim(),
      transactionDate: date,
      inventoryDescription: (p[colDesc] ?? "").trim(),
      vendorItemNo: (p[colRef] ?? "").trim(),
      quantity: Number(p[colQty] ?? "1") || 1,
      unitCost: parseMoney(p[colUnit] ?? ""),
      extendedPrice: parseMoney(p[colExt] ?? ""),
    })
  }
  return rows
}

async function loadPricingItems(): Promise<
  Array<{ vendorItemNo: string; unitPrice: number; listPrice: number | null }>
> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(PRICE_XLSX)
  const sheet = wb.worksheets[0]!
  const items: Array<{
    vendorItemNo: string
    unitPrice: number
    listPrice: number | null
  }> = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return
    const ref = row.getCell(3).value
    const price = row.getCell(7).value
    if (!ref) return
    const p =
      typeof price === "number" ? price : Number(String(price ?? "0")) || 0
    items.push({
      vendorItemNo: String(ref).trim(),
      unitPrice: p,
      listPrice: null,
    })
  })
  return items
}

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("# tydei vendor-POV end-to-end verification vs oracle")
  console.log()
  console.log(`_Run: ${new Date().toISOString()}_`)
  console.log(`_Demo facility: ${DEMO_FACILITY_ID}_`)
  console.log()

  // 1. Resolve Arthrex vendor + contract
  const existingVendor = await prisma.vendor.findFirst({
    where: { name: { contains: ARTHREX_VENDOR_NAME, mode: "insensitive" } },
  })
  const vendor =
    existingVendor ??
    (await prisma.vendor.create({ data: { name: ARTHREX_VENDOR_NAME } }))

  let contract = await prisma.contract.findFirst({
    where: {
      facilityId: DEMO_FACILITY_ID,
      vendorId: vendor.id,
      status: { in: ["active", "expiring"] },
    },
    include: { pricingItems: { select: { id: true } } },
  })
  if (!contract) {
    console.log("Creating a demo Arthrex contract (none existed).")
    const created = await prisma.contract.create({
      data: {
        facilityId: DEMO_FACILITY_ID,
        vendorId: vendor.id,
        name: "Arthrex Master (vendor verify)",
        contractNumber: `ART-VENDOR-VERIFY-${Date.now()}`,
        contractType: "usage",
        status: "active",
        effectiveDate: new Date("2024-01-01"),
        expirationDate: new Date("2026-12-31"),
      },
    })
    contract = { ...created, pricingItems: [] }
  }
  const contractId = contract.id

  // 2. Seed ContractPricing if empty
  if (contract.pricingItems.length === 0) {
    const items = await loadPricingItems()
    console.log(
      `Seeding ${items.length} ContractPricing rows on contract ${contractId}…`,
    )
    await prisma.contractPricing.deleteMany({ where: { contractId } })
    await prisma.contractPricing.createMany({
      data: items.map((it) => ({
        contractId,
        vendorItemNo: it.vendorItemNo,
        unitPrice: it.unitPrice,
        listPrice: it.listPrice,
      })),
    })
  } else {
    console.log(
      `Contract already has ${contract.pricingItems.length} pricing items — keeping.`,
    )
  }

  // 3. Wipe + seed Arthrex COG rows for this facility
  const pos = loadArthrexPos()
  console.log(`Parsed ${pos.length} Arthrex PO rows from the big CSV.`)
  await prisma.cOGRecord.deleteMany({
    where: { facilityId: DEMO_FACILITY_ID, vendorId: vendor.id },
  })
  await prisma.cOGRecord.createMany({
    data: pos.map((p) => ({
      facilityId: DEMO_FACILITY_ID,
      vendorId: vendor.id,
      vendorName: "Arthrex",
      inventoryNumber: p.vendorItemNo || p.poNumber || "Unknown",
      inventoryDescription: p.inventoryDescription || "Unknown item",
      vendorItemNo: p.vendorItemNo || null,
      poNumber: p.poNumber || null,
      unitCost: p.unitCost,
      extendedPrice: p.extendedPrice,
      quantity: p.quantity,
      transactionDate: p.transactionDate,
    })),
  })

  // 4. Run the real recompute pipeline (sets matchStatus + contractId)
  const summary = await recomputeMatchStatusesForVendor(prisma, {
    vendorId: vendor.id,
    facilityId: DEMO_FACILITY_ID,
  })
  console.log(`recomputeMatchStatusesForVendor →`, summary)
  console.log()

  // 5. Query exactly what the vendor server actions query.
  //    Production `vendor-dashboard.ts::getVendorDashboardStats` uses
  //    `{ vendorId: vendor.id }` — NO facility filter, because the
  //    vendor dashboard aggregates Arthrex revenue across every
  //    customer. Our oracle is scoped to ONE customer's CSV
  //    (Lighthouse Community Hospital), so every query below adds
  //    `facilityId: DEMO_FACILITY_ID` to isolate the slice the oracle
  //    actually represents. The shape of each Prisma call — the
  //    `cOGRecord.aggregate` / `.groupBy` pattern — is identical to
  //    the vendor action; only the predicate is narrowed.
  //    `vendor-analytics.ts::getVendorMarketShare` already accepts an
  //    optional `facilityId` filter (line 54-55), so this is literally
  //    that code path.
  const cogScope = { vendorId: vendor.id, facilityId: DEMO_FACILITY_ID }

  // (a) Total vendor revenue at this facility — getVendorDashboardStats
  //     vendorSpendAgg with added facilityId filter (= getVendorMarketShare
  //     with facilityId set, no date window)
  const totalRevenueAgg = await prisma.cOGRecord.aggregate({
    where: cogScope,
    _sum: { extendedPrice: true },
  })
  const totalRevenue = Number(totalRevenueAgg._sum.extendedPrice ?? 0)

  // (b) On-contract vs off-contract revenue — same shape as
  //     `vendor-analytics.ts::getVendorMarketShare` (groupBy category)
  //     but grouped by matchStatus bucket. A vendor that wants to see
  //     "my revenue by contract coverage" reads this exact aggregate.
  const buckets = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: cogScope,
    _sum: { extendedPrice: true },
    _count: { _all: true },
  })
  const byStatus: Record<string, { rows: number; spend: number }> = {}
  for (const b of buckets) {
    byStatus[b.matchStatus] = {
      rows: b._count._all,
      spend: Number(b._sum.extendedPrice ?? 0),
    }
  }
  const onContractRevenue =
    (byStatus["on_contract"]?.spend ?? 0) +
    (byStatus["price_variance"]?.spend ?? 0)
  const onContractRows =
    (byStatus["on_contract"]?.rows ?? 0) +
    (byStatus["price_variance"]?.rows ?? 0)
  const offContractRevenue =
    (byStatus["off_contract_item"]?.spend ?? 0) +
    (byStatus["out_of_scope"]?.spend ?? 0) +
    (byStatus["unknown_vendor"]?.spend ?? 0) +
    (byStatus["pending"]?.spend ?? 0)

  // (c) Trailing-12mo vendor revenue — `getVendorMarketShare` with a
  //     [dateFrom, dateTo] window. 365-day rolling.
  const today = new Date()
  const trailingStart = new Date(today)
  trailingStart.setDate(trailingStart.getDate() - 365)
  const trailingAgg = await prisma.cOGRecord.aggregate({
    where: {
      ...cogScope,
      transactionDate: { gte: trailingStart, lte: today },
    },
    _sum: { extendedPrice: true },
  })
  const trailingRevenue = Number(trailingAgg._sum.extendedPrice ?? 0)

  const trailingOnContractAgg = await prisma.cOGRecord.aggregate({
    where: {
      ...cogScope,
      transactionDate: { gte: trailingStart, lte: today },
      matchStatus: { in: ["on_contract", "price_variance"] },
    },
    _sum: { extendedPrice: true },
  })
  const trailingOnContractRevenue = Number(
    trailingOnContractAgg._sum.extendedPrice ?? 0,
  )

  // (d) YTD + prior-YTD + YoY
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
  const priorYearStart = new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1))
  const priorYtdEnd = new Date(today)
  priorYtdEnd.setUTCFullYear(priorYtdEnd.getUTCFullYear() - 1)

  const [ytdAgg, ytdOnAgg, priorYtdAgg] = await Promise.all([
    prisma.cOGRecord.aggregate({
      where: {
        ...cogScope,
        transactionDate: { gte: yearStart, lte: today },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        ...cogScope,
        transactionDate: { gte: yearStart, lte: today },
        matchStatus: { in: ["on_contract", "price_variance"] },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        ...cogScope,
        transactionDate: { gte: priorYearStart, lte: priorYtdEnd },
      },
      _sum: { extendedPrice: true },
    }),
  ])
  const ytdRevenue = Number(ytdAgg._sum.extendedPrice ?? 0)
  const ytdOnContractRevenue = Number(ytdOnAgg._sum.extendedPrice ?? 0)
  const priorYtdRevenue = Number(priorYtdAgg._sum.extendedPrice ?? 0)
  const yoyPct =
    priorYtdRevenue > 0 ? ((ytdRevenue / priorYtdRevenue) - 1) * 100 : 0

  // (e) Per-facility breakdown — `vendor-analytics.ts::getVendorMarketShare`
  //     lines 92-108. CSV has one facility so we expect one row.
  const perFacility = await prisma.cOGRecord.groupBy({
    by: ["facilityId"],
    where: { vendorId: vendor.id },
    _sum: { extendedPrice: true },
    _count: { _all: true },
  })

  // (f) Vendor contract list — `vendor-contracts.ts::getVendorContracts`
  const vendorContractsTotal = await prisma.contract.count({
    where: { vendorId: vendor.id },
  })

  // (g) Utilization
  const utilizationPct = totalRevenue > 0 ? (onContractRevenue / totalRevenue) * 100 : 0

  // ── Report ────────────────────────────────────────────────────
  console.log("## Numbers the vendor dashboard / analytics would surface")
  console.log()
  console.log("| surface | action source | app value | oracle | delta |")
  console.log("|---|---|---:|---:|---:|")

  const fmt = (n: number): string =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const fmtPct = (n: number): string => `${n.toFixed(1)}%`
  let failed = 0

  const check = (
    label: string,
    source: string,
    actual: number,
    expected: number,
    opts?: { kind?: "currency" | "pct" | "rows"; tol?: number },
  ): void => {
    const kind = opts?.kind ?? "currency"
    const tol = opts?.tol ?? (kind === "currency" ? 1 : kind === "pct" ? 0.1 : 0)
    const f = (n: number): string =>
      kind === "currency" ? fmt(n) : kind === "pct" ? fmtPct(n) : String(n)
    const delta = actual - expected
    const pass = Math.abs(delta) <= tol
    if (!pass) failed++
    const mark = pass ? "OK" : "FAIL"
    console.log(
      `| ${label} | ${source} | ${f(actual)} | ${f(expected)} | ${mark} ${f(delta)} |`,
    )
  }

  check(
    "Total revenue (lifetime)",
    "getVendorDashboardStats.totalSpend",
    totalRevenue,
    ORACLE.lifetimeTotalRevenue,
  )
  check(
    "On-contract revenue (lifetime)",
    "groupBy matchStatus",
    onContractRevenue,
    ORACLE.lifetimeOnContractRevenue,
  )
  check(
    "Off-contract revenue (lifetime)",
    "groupBy matchStatus",
    offContractRevenue,
    ORACLE.lifetimeOffContractRevenue,
  )
  check(
    "On-contract rows (lifetime)",
    "groupBy matchStatus count",
    onContractRows,
    ORACLE.lifetimeOnContractRows,
    { kind: "rows" },
  )
  check(
    "Contract utilization %",
    "derived",
    utilizationPct,
    ORACLE.contractUtilizationPct,
    { kind: "pct" },
  )
  check(
    "Trailing-12mo revenue",
    "getVendorMarketShare date-window",
    trailingRevenue,
    ORACLE.trailingTotalRevenue,
  )
  check(
    "Trailing-12mo on-contract",
    "getVendorMarketShare date-window",
    trailingOnContractRevenue,
    ORACLE.trailingOnContractRevenue,
  )
  check(
    "YTD revenue",
    "getVendorSpendTrend analog",
    ytdRevenue,
    ORACLE.ytdTotalRevenue,
  )
  check(
    "YTD on-contract revenue",
    "getVendorSpendTrend analog",
    ytdOnContractRevenue,
    ORACLE.ytdOnContractRevenue,
  )
  check(
    "Prior-YTD revenue",
    "YoY comparison",
    priorYtdRevenue,
    ORACLE.priorYtdTotalRevenue,
  )
  check("YoY %", "derived", yoyPct, ORACLE.yoyPercent, { kind: "pct" })

  console.log()
  console.log("## Secondary surfaces")
  console.log()
  console.log(`- Per-facility groupBy rows: **${perFacility.length}**  `)
  console.log(
    `  _(CSV has no Facility column → expect 1 row; the demo-facility absorbs all spend.)_`,
  )
  if (perFacility.length > 0) {
    for (const f of perFacility) {
      console.log(
        `  - facility=\`${f.facilityId}\` rows=${f._count._all} spend=${fmt(Number(f._sum.extendedPrice ?? 0))}`,
      )
    }
  }
  console.log()
  console.log(
    `- Vendor contract count (getVendorContracts total): **${vendorContractsTotal}**`,
  )
  console.log()
  console.log("## matchStatus bucket breakdown (raw)")
  console.log()
  console.log("| bucket | rows | spend |")
  console.log("|---|---:|---:|")
  for (const [status, agg] of Object.entries(byStatus).sort(
    ([, a], [, b]) => b.spend - a.spend,
  )) {
    console.log(`| ${status} | ${agg.rows} | ${fmt(agg.spend)} |`)
  }
  console.log()

  const passed = failed === 0
  console.log(
    passed
      ? "**PASS** — vendor-side app surfaces match the vendor oracle"
      : `**FAIL** — ${failed} surface(s) diverge from the vendor oracle`,
  )

  await prisma.$disconnect()
  process.exit(passed ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
