/**
 * Project the on / off-contract split for Charles's two fixture files
 * through the exact parse → map → match pipeline the app uses — no DB
 * writes. Purpose: answer "what would the numbers be if we re-imported
 * on the patched build?"
 *
 * Inputs:
 *   /Users/vickkumar/Desktop/experiment COG vendor short NEW.csv
 *   /Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx
 *
 * Assumes:
 *   - Pricing items belong to a single Arthrex contract with an
 *     effective window that covers every transactionDate in the COG
 *     file (so date-window filtering isn't the bottleneck).
 *   - Every COG row whose `Vendor` column contains "ARTHREX" maps to
 *     that contract's vendorId. Other vendors are "unknown_vendor" for
 *     the purpose of this projection since no contract exists for them.
 */
import { readFileSync } from "node:fs"
import ExcelJS from "exceljs"
import {
  localFallbackMap,
  parseCSV,
  parseMoney,
  parseDate,
  get,
} from "@/lib/actions/imports/shared"
import {
  buildPricingItems,
  detectPricingColumnMapping,
} from "@/lib/utils/parse-pricing-file"

const COG_CSV = "/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv"
const PRICING_XLSX = "/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx"

const COG_TARGETS = [
  { key: "vendorName", label: "Vendor / Supplier Name", required: true },
  {
    key: "transactionDate",
    label: "Date Ordered / Transaction Date",
    required: true,
  },
  { key: "description", label: "Product Name / Item Description", required: false },
  {
    key: "refNumber",
    label: "Catalog / Product Reference / Vendor Item Number",
    required: false,
  },
  { key: "quantity", label: "Quantity Ordered", required: false },
  { key: "unitCost", label: "Unit Cost / Unit Price", required: false },
  {
    key: "extended",
    label: "Extended Cost / Total Line Cost",
    required: false,
  },
  { key: "poNumber", label: "Purchase Order Number", required: false },
  {
    key: "multiplier",
    label:
      "Multiplier / Case Pack / Units per Line / Conversion Factor / Conversion Factor Ordered",
    required: false,
  },
]

async function main() {
  // ── Parse COG CSV ──
  const csvText = readFileSync(COG_CSV, "utf8")
  const cogRows = parseCSV(csvText)
  const cogHeaders = cogRows.length > 0 ? Object.keys(cogRows[0]) : []
  const cogMapping = localFallbackMap(cogHeaders, COG_TARGETS)
  console.log(`[cog] ${cogRows.length} rows, mapping:`, cogMapping)

  // ── Parse Pricing XLSX ──
  const bytes = readFileSync(PRICING_XLSX)
  const wb = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(bytes as any)
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error("no sheets in pricing xlsx")
  const headerRow = sheet.getRow(1)
  const rawHeaders = (headerRow.values as (ExcelJS.CellValue | undefined)[])
    .slice(1)
    .map((v) => (v != null ? String(v).trim() : ""))
  const dataRows: string[][] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const values = row.values as (ExcelJS.CellValue | undefined)[]
    dataRows.push(
      rawHeaders.map((_, i) => {
        const v = values[i + 1]
        return v != null ? String(v) : ""
      }),
    )
  })
  const pricingMapping = detectPricingColumnMapping(rawHeaders)
  const pricing = buildPricingItems(dataRows, rawHeaders, pricingMapping)
  const pricingByItem = new Map<string, number>()
  for (const p of pricing) {
    pricingByItem.set(p.vendorItemNo, p.unitPrice)
  }
  console.log(
    `[pricing] ${pricing.length} items loaded from ${dataRows.length} rows`,
  )

  // ── Classify COG rows ──
  // Buckets the real recompute uses.
  let onContract = 0
  let onContractSpend = 0
  let priceVariance = 0
  let priceVarianceSpend = 0
  let offContractItem = 0
  let offContractItemSpend = 0
  let unknownVendor = 0
  let unknownVendorSpend = 0
  let skipped = 0

  // Matches `lib/cog/match.ts` PRICE_VARIANCE_THRESHOLD default.
  const VARIANCE_THRESHOLD = 0.02 // 2%

  for (const row of cogRows) {
    const vendorName = get(row, cogMapping, "vendorName")
    const date = parseDate(get(row, cogMapping, "transactionDate"))
    if (!vendorName || !date) {
      skipped++
      continue
    }
    const refNumber = get(row, cogMapping, "refNumber")
    const qty = parseInt(get(row, cogMapping, "quantity") || "1", 10) || 1
    const rawMult = get(row, cogMapping, "multiplier")
    const multiplier = rawMult
      ? parseFloat(rawMult.replace(/[^0-9.]/g, "")) || 1
      : 1
    const unitCost = parseMoney(get(row, cogMapping, "unitCost"))
    const explicit = parseMoney(get(row, cogMapping, "extended"))
    const extended = explicit > 0 ? explicit : unitCost * qty * multiplier

    // Only Arthrex rows could possibly match this contract. Everything
    // else is treated as unknown_vendor for this projection (no other
    // contracts in play).
    const isArthrex = vendorName.toUpperCase().includes("ARTHREX")
    if (!isArthrex) {
      unknownVendor++
      unknownVendorSpend += extended
      continue
    }

    const pricedAt = refNumber ? pricingByItem.get(refNumber) : undefined
    if (pricedAt !== undefined) {
      // Variance = |actual unit cost − contract unit price| / contract price
      const delta = Math.abs(unitCost - pricedAt) / (pricedAt || 1)
      if (delta <= VARIANCE_THRESHOLD) {
        onContract++
        onContractSpend += extended
      } else {
        priceVariance++
        priceVarianceSpend += extended
      }
    } else {
      // Arthrex vendor + in-window + item not in pricing → off_contract_item.
      offContractItem++
      offContractItemSpend += extended
    }
  }

  const totalArthrex = onContract + priceVariance + offContractItem
  const totalSpend =
    onContractSpend +
    priceVarianceSpend +
    offContractItemSpend +
    unknownVendorSpend
  const fmt = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    })
  const pct = (n: number, d: number) =>
    d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—"

  console.log(`\n## Projection — single Arthrex contract with this pricing\n`)
  console.log(
    `Arthrex rows (in scope): ${totalArthrex}`,
  )
  console.log(
    `  on_contract:        ${onContract.toString().padStart(6)} (${pct(onContract, totalArthrex)}) · ${fmt(onContractSpend)}`,
  )
  console.log(
    `  price_variance:     ${priceVariance.toString().padStart(6)} (${pct(priceVariance, totalArthrex)}) · ${fmt(priceVarianceSpend)}`,
  )
  console.log(
    `  off_contract_item:  ${offContractItem.toString().padStart(6)} (${pct(offContractItem, totalArthrex)}) · ${fmt(offContractItemSpend)}`,
  )
  console.log(
    `\nNon-Arthrex rows (no contract):`,
  )
  console.log(
    `  unknown_vendor:     ${unknownVendor.toString().padStart(6)} · ${fmt(unknownVendorSpend)}`,
  )
  console.log(
    `\nRow total:  ${cogRows.length} (skipped ${skipped})`,
  )
  console.log(
    `Spend total: ${fmt(totalSpend)}`,
  )
  console.log(
    `\nOn-contract share of Arthrex spend:  ${pct(onContractSpend, onContractSpend + priceVarianceSpend + offContractItemSpend)}`,
  )
  console.log(
    `On-contract share of TOTAL spend:    ${pct(onContractSpend, totalSpend)}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
