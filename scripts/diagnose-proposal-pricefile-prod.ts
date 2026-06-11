/**
 * diagnose-proposal-pricefile-prod — verify the 2026-06-10 price-file
 * reader fix end-to-end against the PRODUCTION (Railway) database.
 *
 * Replicates the exact UI pipeline of the proposal analyzer's price-file
 * ask (upload-proposal-tab.tsx handlePricingFile):
 *   1. /api/parse-file equivalent: read the xlsx, scan for the header row,
 *      dedupe headers, build Record<string,string> rows.
 *   2. pricingRowsToItems (the FIXED reader — canonical header aliases).
 *   3. getCogPricingBenchmarks equivalent: read-only COGRecord query
 *      scoped to the facility + vendor, quantity-weighted avg unit cost.
 *   4. analyzePricingFile → the summary the UI toasts/cards render.
 *
 * READ-ONLY: only findMany/findFirst queries. Safe against prod.
 *
 * Usage:
 *   DATABASE_URL="$(railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL | cut -d= -f2-)" \
 *     bun scripts/diagnose-proposal-pricefile-prod.ts "/path/to/price file.xlsx" [vendorName] [facilityName]
 *
 * Defaults: vendor "Arthrex", facility "Lighthouse Surgical Center".
 */
import * as XLSX from "xlsx"
import { prisma } from "@/lib/db"
import { pricingRowsToItems } from "@/components/facility/analysis/prospective/pricing-file-reader"
import {
  analyzePricingFile,
  type PricingFileItem,
} from "@/lib/prospective-analysis/pricing-file-analysis"
import { normalizeSku } from "@/lib/contracts/normalize-sku"

const filePath = process.argv[2]
const vendorNameArg = process.argv[3] ?? "Arthrex"
const facilityNameArg = process.argv[4] ?? "Lighthouse Surgical Center"

if (!filePath) {
  console.error("Usage: bun scripts/diagnose-proposal-pricefile-prod.ts <price-file.xlsx> [vendorName] [facilityName]")
  process.exit(1)
}

// ── Step 1: /api/parse-file equivalent ─────────────────────────────
const HEADER_TOKENS = [
  "item", "sku", "part", "ref", "reference", "catalog", "product",
  "description", "desc", "price", "cost", "uom", "unit", "category",
  "vendor", "manufacturer", "list", "contract", "discount", "msrp",
]

function parseFileLikeServer(path: string): {
  headers: string[]
  rows: Record<string, string>[]
  headerRowIndex: number
} {
  const wb = XLSX.readFile(path)
  const ws = wb.Sheets[wb.SheetNames[0]!]
  if (!ws) throw new Error("No sheets found")
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  })
  const matrix = raw.map((row) => (row ?? []).map((v) => String(v ?? "").trim()))

  const looksLikeHeader = (row: string[]) => {
    const joined = row.join(" ").toLowerCase()
    return HEADER_TOKENS.some((t) => joined.includes(t))
  }
  const nonEmptyCount = (row: string[]) => row.filter((c) => c).length

  const SCAN_LIMIT = Math.min(matrix.length, 15)
  let headerRowIdx = -1
  let bestScore = 0
  for (let r = 0; r < SCAN_LIMIT; r += 1) {
    const row = matrix[r] ?? []
    if (!looksLikeHeader(row)) continue
    const score = nonEmptyCount(row)
    if (score > bestScore) {
      bestScore = score
      headerRowIdx = r
    }
  }
  if (headerRowIdx === -1) headerRowIdx = 0

  const seen = new Map<string, number>()
  const headers = (matrix[headerRowIdx] ?? []).map((h) => {
    const trimmed = h.trim()
    if (!trimmed) return trimmed
    const lower = trimmed.toLowerCase()
    const count = (seen.get(lower) ?? 0) + 1
    seen.set(lower, count)
    return count === 1 ? trimmed : `${trimmed} (${count})`
  })

  const rows: Record<string, string>[] = []
  for (let r = headerRowIdx + 1; r < matrix.length; r += 1) {
    const arr = matrix[r] ?? []
    if (arr.every((c) => !c)) continue
    const record: Record<string, string> = {}
    headers.forEach((h, idx) => {
      if (!h) return
      record[h] = arr[idx] ?? ""
    })
    rows.push(record)
  }
  return { headers: headers.filter((h) => h !== ""), rows, headerRowIndex: headerRowIdx }
}

async function main() {
  console.log(`# Proposal price-file pipeline vs PROD — ${new Date().toISOString()}\n`)
  console.log(`File: ${filePath}`)

  const { headers, rows, headerRowIndex } = parseFileLikeServer(filePath!)
  console.log(`Header row index: ${headerRowIndex}`)
  console.log(`Headers: ${JSON.stringify(headers)}`)
  console.log(`Data rows: ${rows.length}`)

  // ── Step 2: the fixed reader ──────────────────────────────────────
  const items = pricingRowsToItems(headers, rows)
  console.log(`\npricingRowsToItems → ${items.length} items (was 0 before the fix)`)
  if (items.length === 0) {
    console.error("STILL ZERO ITEMS — fix did not take. Aborting before DB work.")
    process.exit(1)
  }
  console.log(`Sample: ${JSON.stringify(items[0])}`)

  // ── Step 3: prod COG benchmark join (read-only) ───────────────────
  const facility = await prisma.facility.findFirst({
    where: { name: facilityNameArg },
    select: { id: true, name: true },
  })
  if (!facility) throw new Error(`Facility "${facilityNameArg}" not found in prod`)
  const vendor = await prisma.vendor.findFirst({
    where: { name: { contains: vendorNameArg, mode: "insensitive" } },
    select: { id: true, name: true },
  })
  console.log(`\nFacility: ${facility.name} (${facility.id})`)
  console.log(`Vendor:   ${vendor ? `${vendor.name} (${vendor.id})` : "NOT FOUND — joining unscoped"}`)

  const wanted = new Set(
    items.map((i) => normalizeSku(i.itemNumber)).filter((s) => s.length > 0),
  )
  const windowEnd = new Date()
  const windowStart = new Date(windowEnd)
  windowStart.setFullYear(windowStart.getFullYear() - 1)
  const rawSkuVariants = Array.from(
    new Set(items.flatMap((i) => [i.itemNumber, i.itemNumber.trim()]).filter((s) => s.length > 0)),
  )
  const cogRows = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorItemNo: { in: rawSkuVariants, mode: "insensitive" },
      transactionDate: { gte: windowStart, lte: windowEnd },
      ...(vendor ? { vendorId: vendor.id } : {}),
    },
    select: { vendorItemNo: true, unitCost: true, quantity: true },
  })
  console.log(`COG rows in 12-month window matching file SKUs: ${cogRows.length}`)

  const bySku = new Map<string, { cost: number; qty: number }>()
  for (const r of cogRows) {
    const key = normalizeSku(r.vendorItemNo)
    if (!wanted.has(key)) continue
    const unit = r.unitCost == null ? null : Number(r.unitCost)
    if (unit == null) continue
    const qty = r.quantity ?? 0
    const w = qty > 0 ? qty : 1
    const cur = bySku.get(key) ?? { cost: 0, qty: 0 }
    cur.cost += unit * w
    cur.qty += w
    bySku.set(key, cur)
  }

  // ── Step 4: join + analyze (mirrors handlePricingFile) ────────────
  const joined: PricingFileItem[] = items.map((i) => {
    const b = bySku.get(normalizeSku(i.itemNumber))
    if (!b) return i
    return {
      ...i,
      currentPrice: b.qty > 0 ? b.cost / b.qty : 0,
      estimatedAnnualQty: i.estimatedAnnualQty ?? b.qty,
    }
  })
  const result = analyzePricingFile(joined)
  const s = result.summary
  console.log(`\nUI toast would read: "Price file analyzed — ${s.itemsWithCOGMatch} of ${s.totalItems} lines matched to COG"`)
  console.log(`\nSummary:`)
  console.log(`  itemsWithCOGMatch:        ${s.itemsWithCOGMatch}`)
  console.log(`  itemsWithoutCOGMatch:     ${s.itemsWithoutCOGMatch}`)
  console.log(`  avgVariancePercent:       ${s.avgVariancePercent.toFixed(2)}%`)
  console.log(`  totalProposedAnnualSpend: $${Math.round(s.totalProposedAnnualSpend).toLocaleString()}`)
  console.log(`  totalCurrentAnnualSpend:  $${Math.round(s.totalCurrentAnnualSpend).toLocaleString()}`)
  console.log(`  potentialSavings:         $${Math.round(s.potentialSavings).toLocaleString()}`)
  console.log(`  itemsBelowCOG / above:    ${s.itemsBelowCOG} / ${s.itemsAboveCOG}`)

  const matched = result.lines.filter((l) => l.currentPrice !== null).slice(0, 5)
  console.log(`\nSample matched lines:`)
  for (const l of matched) {
    console.log(
      `  ${l.itemNumber.padEnd(16)} proposed $${l.proposedPrice.toFixed(2).padStart(9)}  current $${(l.currentPrice ?? 0).toFixed(2).padStart(9)}  var ${(l.variancePercent ?? 0).toFixed(1)}%`,
    )
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
