/**
 * End-to-end verification: drive Charles's exact files through the tydei
 * app's real data pipeline, then print the numbers the APP WOULD SHOW
 * on each surface. This is NOT an oracle — it uses:
 *
 *   - The real Prisma writes the importer uses (COGRecord, ContractPricing)
 *   - The real recompute pipeline (`recomputeMatchStatusesForVendor`)
 *   - The same Prisma queries + canonical helpers the contract-detail
 *     page (`getContract`) and off-contract-spend card use
 *
 * What we skip:
 *   - HTTP/auth layer (we call library functions directly rather than go
 *     through `requireFacility`-gated server actions). The data shapes
 *     are identical — server actions are thin wrappers over these calls.
 *
 * Output: prints the hero numbers the contract-detail page would render
 * for the demo-facility Arthrex contract after seeding Charles's files,
 * and compares them against the independent oracle's ground truth.
 *
 * Usage:
 *   bun --env-file=.env scripts/verify-app-against-oracle.ts
 *     [> docs/superpowers/diagnostics/2026-04-23-app-vs-oracle.md]
 */
import { readFileSync } from "node:fs"
import ExcelJS from "exceljs"
import { prisma } from "@/lib/db"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import {
  sumEarnedRebatesLifetime,
  sumEarnedRebatesYTD,
} from "@/lib/contracts/rebate-earned-filter"

const DEMO_FACILITY_ID = "cmo6j6fx70004achlf8fr82h2" // Lighthouse Community Hospital
const COG_CSV = "/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv"
const PRICE_XLSX = "/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx"
const ARTHREX_VENDOR_NAME = "Arthrex"

// Oracle ground truth (from scripts/oracle_all_desktop.py, 2026-04-23):
const ORACLE = {
  lifetimeOnContractRows: 1037,
  lifetimeOnContractSpend: 1_829_277.4,
  lifetimeNotPricedSpend: 3_118_653.43,
  lifetimeTotalSpend: 4_947_930.83,
  trailingOnContractSpend: 1_718_979.57,
  trailingTotalSpend: 4_065_791.99,
}

// ─── CSV (same parser as the live mass-upload) ────────────────────

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
  const idx = (name: string) =>
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

async function main() {
  console.log("# tydei app end-to-end verification vs oracle")
  console.log()
  console.log(`_Run: ${new Date().toISOString()}_`)
  console.log(`_Demo facility: ${DEMO_FACILITY_ID}_`)
  console.log()

  // ── 1. Resolve Arthrex vendor + contract at the demo facility ──
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
        name: "Arthrex Master (verification)",
        contractNumber: `ART-VERIFY-${Date.now()}`,
        contractType: "usage",
        status: "active",
        effectiveDate: new Date("2024-01-01"),
        expirationDate: new Date("2026-12-31"),
      },
    })
    contract = { ...created, pricingItems: [] }
  }
  const contractId = contract.id

  // ── 2. Seed ContractPricing from the XLSX (10,394 items) ──────
  const existingPricing = contract.pricingItems.length
  if (existingPricing === 0) {
    const items = await loadPricingItems()
    console.log(
      `Seeding ${items.length} ContractPricing rows on contract ${contractId}…`,
    )
    // Delete-and-createMany is safest; we're on a dev DB.
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
    console.log(`Contract already has ${existingPricing} pricing items — keeping.`)
  }

  // ── 3. Wipe + seed Arthrex COG rows for this facility ────────
  const pos = loadArthrexPos()
  console.log(`Parsed ${pos.length} Arthrex PO rows from the big CSV.`)
  await prisma.cOGRecord.deleteMany({
    where: { facilityId: DEMO_FACILITY_ID, vendorId: vendor.id },
  })
  // Same shape the bulk importer writes.
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

  // ── 4. Run the real recompute pipeline ───────────────────────
  const summary = await recomputeMatchStatusesForVendor(prisma, {
    vendorId: vendor.id,
    facilityId: DEMO_FACILITY_ID,
  })
  console.log(`recomputeMatchStatusesForVendor →`, summary)

  // ── 5. Query exactly what the contract-detail card reads ─────
  //      (same shape as lib/actions/contracts.ts::getContract,
  //      minus the `requireFacility` / ownership gate which is an
  //      auth concern, not a data-math concern).
  const fresh = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      rebates: {
        select: {
          id: true,
          rebateEarned: true,
          rebateCollected: true,
          payPeriodEnd: true,
          collectionDate: true,
        },
      },
    },
  })
  const today = new Date()
  const rebateEarned = sumEarnedRebatesLifetime(fresh.rebates, today)
  const rebateEarnedYTD = sumEarnedRebatesYTD(fresh.rebates, today)
  const rebateCollected = sumCollectedRebates(fresh.rebates)

  // trailing-12mo cascade (same order as getContract)
  const windowEnd = new Date()
  const windowStart = new Date(windowEnd)
  windowStart.setFullYear(windowStart.getFullYear() - 1)
  const [cogContract, cogVendor, period] = await Promise.all([
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: DEMO_FACILITY_ID,
        contractId,
        transactionDate: { gte: windowStart, lte: windowEnd },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: DEMO_FACILITY_ID,
        vendorId: vendor.id,
        transactionDate: { gte: windowStart, lte: windowEnd },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.contractPeriod.aggregate({
      where: {
        contractId,
        periodStart: { gte: windowStart },
        periodEnd: { lte: windowEnd },
      },
      _sum: { totalSpend: true },
    }),
  ])
  const cogSpend = Number(cogContract._sum.extendedPrice ?? 0)
  const cogVendorSpend = Number(cogVendor._sum.extendedPrice ?? 0)
  const periodSpend = Number(period._sum.totalSpend ?? 0)
  const currentSpend =
    periodSpend > 0 ? periodSpend : cogSpend > 0 ? cogSpend : cogVendorSpend

  // On-vs-off card reads aggregate counts of matchStatus ∈
  // (on_contract, price_variance) vs the rest, scoped to (contract OR
  // contract-null+same-vendor). Same query shape as
  // lib/actions/contracts/off-contract-spend.ts.
  const buckets = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: {
      facilityId: DEMO_FACILITY_ID,
      OR: [{ contractId }, { contractId: null, vendorId: vendor.id }],
    },
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
  const onContractSpend =
    (byStatus["on_contract"]?.spend ?? 0) +
    (byStatus["price_variance"]?.spend ?? 0)
  const onContractRows =
    (byStatus["on_contract"]?.rows ?? 0) +
    (byStatus["price_variance"]?.rows ?? 0)
  const offContractSpend =
    (byStatus["off_contract_item"]?.spend ?? 0) +
    (byStatus["out_of_scope"]?.spend ?? 0) +
    (byStatus["unknown_vendor"]?.spend ?? 0) +
    (byStatus["pending"]?.spend ?? 0)

  // ── 6. Print what the app would show ─────────────────────────
  console.log()
  console.log("## Numbers the app would surface on the contract-detail page")
  console.log()
  console.log("| surface | value | oracle | delta |")
  console.log("|---|---:|---:|---:|")
  const row = (
    label: string,
    actual: number,
    expected: number,
    fmt: "currency" | "rows" = "currency",
  ) => {
    const f = (n: number) =>
      fmt === "currency"
        ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : String(n)
    const delta = actual - expected
    const tol = fmt === "currency" ? 1 : 0 // pennies tolerance
    const mark = Math.abs(delta) <= tol ? "✅" : "❌"
    console.log(`| ${label} | ${f(actual)} | ${f(expected)} | ${mark} ${f(delta)} |`)
  }
  row("On-contract rows (lifetime)", onContractRows, ORACLE.lifetimeOnContractRows, "rows")
  row("On-contract spend (lifetime)", onContractSpend, ORACLE.lifetimeOnContractSpend)
  row("Off-contract spend (lifetime)", offContractSpend, ORACLE.lifetimeNotPricedSpend)
  row("Current Spend (trailing 12mo)", currentSpend, ORACLE.trailingOnContractSpend)

  console.log()
  console.log("## Header-card numbers (from canonical helpers)")
  console.log()
  console.log(`- Rebates Earned (lifetime): $${rebateEarned.toFixed(2)}`)
  console.log(`- Rebates Earned (YTD):      $${rebateEarnedYTD.toFixed(2)}`)
  console.log(`- Rebates Collected:         $${rebateCollected.toFixed(2)}`)
  console.log(
    "_(Rebate numbers are $0 because no Rebate rows exist for this synthetic contract — that's correct: rebates are never auto-computed for display per CLAUDE.md.)_",
  )

  const passed =
    Math.abs(onContractRows - ORACLE.lifetimeOnContractRows) <= 0 &&
    Math.abs(onContractSpend - ORACLE.lifetimeOnContractSpend) <= 1 &&
    Math.abs(offContractSpend - ORACLE.lifetimeNotPricedSpend) <= 1
  console.log()
  console.log(passed ? "**PASS** — app surfaces match oracle" : "**FAIL** — app diverges from oracle")

  await prisma.$disconnect()
  process.exit(passed ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
