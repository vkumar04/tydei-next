/**
 * W2.A.1 Task 7 — Scale regression for the recompute pipeline.
 *
 * Exercises the same pure match/enrichment code paths that
 * `recomputeMatchStatusesForVendor` uses, against Charles's real
 * Arthrex files:
 *
 *   /Users/vickkumar/Desktop/experiment COG vendor short NEW.csv
 *   /Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx
 *
 * Oracle (docs/superpowers/diagnostics/2026-04-22-oracle-arthrex-cluster.md):
 * when ~1,037 Arthrex POs match vendorItemNo to the 10,424-row price file
 * we should see (on_contract + price_variance) ≥ 1,000.
 *
 * Why pure-function instead of a live DB round-trip: the pipeline's
 * DB I/O is a thin wrapper around `matchCOGRecordToContract`,
 * `resolveContractForCOG`, and `enrichCOGRecord`. Running those against
 * the real files catches any drift in the matcher's cascade (the three
 * invocation-site fixes in W2.A.1 make sure we CALL the pipeline;
 * this script makes sure the pipeline returns the right answer).
 *
 * This script does not read or write the dev DB. Safe to run anytime.
 *
 * Usage:
 *   bun scripts/regression-charles-arthrex-pipeline.ts \
 *     > docs/superpowers/diagnostics/2026-04-22-w2a1-pipeline-regression.md
 *
 * Exit code: 0 on success (≥ 1,000 matches), 1 on failure.
 */

import { readFileSync } from "node:fs"
import ExcelJS from "exceljs"
import {
  matchCOGRecordToContract,
  type ContractForMatch,
  type ContractPricingItemForMatch,
} from "@/lib/contracts/match"
import { enrichCOGRecord } from "@/lib/cog/enrichment"
import {
  resolveContractForCOG,
  type ContractCandidate,
  type PricingCandidate,
  type ResolveContext,
} from "@/lib/cog/match"

const COG_CSV = "/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv"
const PRICE_XLSX = "/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx"

const MATCH_FLOOR = 1000 // oracle = 1,037 ± tolerance

// ─── CSV parse (delimiter + quoted fields, no dep) ──────────────
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

type CogRow = {
  vendor: string
  poNumber: string
  transactionDate: Date
  productName: string
  vendorItemNo: string
  quantity: number
  unitCost: number
  extendedPrice: number
}

function parseCsvDate(s: string): Date {
  // CSV uses `M/D/YY` (e.g. "1/9/25").
  const [mStr, dStr, yStr] = s.split("/")
  const m = Number(mStr)
  const d = Number(dStr)
  let y = Number(yStr)
  if (y < 100) y += 2000
  return new Date(y, m - 1, d)
}

function loadCog(): CogRow[] {
  const text = readFileSync(COG_CSV, "utf8")
  const lines = text.split(/\r?\n/)
  // Strip BOM from header.
  const header = splitCsvLine(lines[0]!.replace(/^﻿/, ""))
  const idx = {
    vendor: header.indexOf("Vendor"),
    po: header.indexOf("Purchase Order Number"),
    date: header.indexOf("Date Ordered"),
    name: header.indexOf("product name"),
    ref: header.indexOf("Product ref number"),
    qty: header.indexOf("Quantity Ordered"),
    unit: header.indexOf("Unit Cost"),
    ext: header.indexOf("Extended Cost"),
  }
  const rows: CogRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const parts = splitCsvLine(line)
    if (parts.length < header.length) continue
    rows.push({
      vendor: parts[idx.vendor]!.trim(),
      poNumber: parts[idx.po]!.trim(),
      transactionDate: parseCsvDate(parts[idx.date]!.trim()),
      productName: parts[idx.name]!.trim(),
      vendorItemNo: parts[idx.ref]!.trim(),
      quantity: Number(parts[idx.qty]) || 0,
      unitCost: Number(parts[idx.unit]) || 0,
      extendedPrice: Number(parts[idx.ext]) || 0,
    })
  }
  return rows
}

type PriceRow = {
  vendorItemNo: string
  unitPrice: number
  listPrice: number | null
  description: string
}

async function loadPrice(): Promise<PriceRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(PRICE_XLSX)
  const ws = wb.worksheets[0]!
  const headerRow = ws.getRow(1)
  const headers: string[] = []
  headerRow.eachCell((cell, col) => {
    headers[col - 1] = String(cell.value ?? "").trim()
  })

  // Detect the column whose header contains "Product ref" or
  // similar — the exact naming varies between price-file exports.
  const findCol = (needle: string): number => {
    const lower = needle.toLowerCase()
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i]
      if (h && h.toLowerCase().includes(lower)) return i + 1
    }
    return -1
  }
  // Price file exports vary in schema. Accept either "Product ref"
  // (older naming) or "ReferenceNumber" (current Charles export).
  const refCol =
    findCol("product ref") !== -1
      ? findCol("product ref")
      : findCol("referencenumber") !== -1
        ? findCol("referencenumber")
        : findCol("reference")
  const priceCol =
    findCol("unit cost") !== -1 ? findCol("unit cost") : findCol("price")
  const listCol = findCol("list")
  const descCol =
    findCol("product name") !== -1
      ? findCol("product name")
      : findCol("description")

  if (refCol === -1 || priceCol === -1) {
    throw new Error(
      `Price file missing expected columns. Headers=${JSON.stringify(headers)}`,
    )
  }

  const rows: PriceRow[] = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const ref = String(row.getCell(refCol).value ?? "").trim()
    if (!ref) continue
    const unit = Number(row.getCell(priceCol).value ?? 0)
    const list = listCol !== -1 ? Number(row.getCell(listCol).value ?? 0) : 0
    rows.push({
      vendorItemNo: ref,
      unitPrice: unit,
      listPrice: list > 0 ? list : null,
      description: descCol !== -1 ? String(row.getCell(descCol).value ?? "").trim() : "",
    })
  }
  return rows
}

// ─── Match-status distribution counter ─────────────────────────────
type Summary = {
  total: number
  onContract: number
  priceVariance: number
  offContract: number
  outOfScope: number
  unknownVendor: number
  pending: number
}

function emptySummary(): Summary {
  return {
    total: 0,
    onContract: 0,
    priceVariance: 0,
    offContract: 0,
    outOfScope: 0,
    unknownVendor: 0,
    pending: 0,
  }
}

async function main() {
  const startMs = Date.now()
  process.stderr.write("[regression] loading COG CSV…\n")
  const cogAll = loadCog()
  process.stderr.write(`[regression] CSV rows: ${cogAll.length}\n`)

  // Arthrex-only slice. The CSV is cross-vendor; Arthrex rows are the
  // ones where the vendor column contains "ARTHREX" (case-insensitive).
  const arthrexCog = cogAll.filter((r) =>
    r.vendor.toUpperCase().includes("ARTHREX"),
  )
  process.stderr.write(
    `[regression] Arthrex COG rows: ${arthrexCog.length}\n`,
  )

  process.stderr.write("[regression] loading price XLSX…\n")
  const priceRows = await loadPrice()
  process.stderr.write(`[regression] price rows: ${priceRows.length}\n`)

  // ─── Build a single synthetic contract representing the Arthrex line-sheet ─
  const VENDOR_ID = "v-arthrex"
  const FACILITY_ID = "fac-test"
  const contract: ContractForMatch = {
    id: "c-arthrex-master",
    vendorId: VENDOR_ID,
    status: "active",
    // Wide window covering Charles's data (2024–2025).
    effectiveDate: new Date("2024-01-01"),
    expirationDate: new Date("2026-12-31"),
    facilityIds: [FACILITY_ID],
    pricingItems: priceRows.map<ContractPricingItemForMatch>((p) => ({
      vendorItemNo: p.vendorItemNo,
      unitPrice: p.unitPrice,
      listPrice: p.listPrice,
    })),
    terms: [],
  }

  // Build cascade lookup maps once (same as recompute.ts).
  const pricingByVendorItem = new Map<string, PricingCandidate[]>()
  const activeContractsByVendor = new Map<string, ContractCandidate[]>()
  const contractCandidate: ContractCandidate = {
    id: contract.id,
    effectiveDate: contract.effectiveDate,
    expirationDate: contract.expirationDate,
  }
  activeContractsByVendor.set(VENDOR_ID, [contractCandidate])
  for (const p of contract.pricingItems) {
    const pricingCandidate: PricingCandidate = {
      contractId: contract.id,
      effectiveStart: contract.effectiveDate,
      effectiveEnd: contract.expirationDate!,
    }
    const list = pricingByVendorItem.get(p.vendorItemNo) ?? []
    list.push(pricingCandidate)
    pricingByVendorItem.set(p.vendorItemNo, list)
  }

  const resolveCtx: ResolveContext = {
    pricingByVendorItem,
    activeContractsByVendor,
    fuzzyVendorMatch: () => null,
  }

  const summary = emptySummary()

  for (const r of arthrexCog) {
    summary.total++
    // Same two-step resolve+match as recomputeMatchStatusesForVendor.
    const cascade = resolveContractForCOG(
      {
        vendorItemNo: r.vendorItemNo || null,
        vendorId: VENDOR_ID,
        transactionDate: r.transactionDate,
        vendorName: r.vendor,
      },
      resolveCtx,
    )
    const result = matchCOGRecordToContract(
      {
        facilityId: FACILITY_ID,
        vendorId: VENDOR_ID,
        vendorName: r.vendor,
        vendorItemNo: r.vendorItemNo || null,
        unitCost: r.unitCost,
        quantity: r.quantity,
        transactionDate: r.transactionDate,
      },
      [contract],
    )
    const effectiveResult =
      result.status === "off_contract_item" &&
      cascade.contractId !== null &&
      (cascade.mode === "vendorAndDate" || cascade.mode === "fuzzyVendorName")
        ? { status: "on_contract" as const, contractId: cascade.contractId, contractPrice: 0, savings: 0 }
        : result

    const cols = enrichCOGRecord(effectiveResult, {
      quantity: r.quantity,
      unitCost: r.unitCost,
    })
    switch (cols.matchStatus) {
      case "on_contract":
        summary.onContract++
        break
      case "price_variance":
        summary.priceVariance++
        break
      case "off_contract_item":
        summary.offContract++
        break
      case "out_of_scope":
        summary.outOfScope++
        break
      case "unknown_vendor":
        summary.unknownVendor++
        break
      default:
        summary.pending++
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
  const matched = summary.onContract + summary.priceVariance

  // ─── Markdown report to stdout ──────────────────────────────────
  console.log(`# W2.A.1 pipeline regression — ${new Date().toISOString()}`)
  console.log()
  console.log(`Runtime: ${elapsed}s`)
  console.log()
  console.log("## Inputs")
  console.log()
  console.log(`- COG CSV: \`${COG_CSV}\` (all rows = ${cogAll.length})`)
  console.log(`- Arthrex rows in CSV: ${arthrexCog.length}`)
  console.log(`- Price file: \`${PRICE_XLSX}\` (${priceRows.length} items)`)
  console.log()
  console.log("## matchStatus distribution (Arthrex)")
  console.log()
  console.log("| Status | Count |")
  console.log("|---|---:|")
  console.log(`| on_contract      | ${summary.onContract} |`)
  console.log(`| price_variance   | ${summary.priceVariance} |`)
  console.log(`| off_contract_item| ${summary.offContract} |`)
  console.log(`| out_of_scope     | ${summary.outOfScope} |`)
  console.log(`| unknown_vendor   | ${summary.unknownVendor} |`)
  console.log(`| pending          | ${summary.pending} |`)
  console.log(`| **total**        | **${summary.total}** |`)
  console.log()
  console.log(`## Oracle check`)
  console.log()
  console.log(`Expected: on_contract + price_variance ≥ ${MATCH_FLOOR}`)
  console.log(`Actual:   ${matched}`)
  console.log()
  if (matched >= MATCH_FLOOR) {
    console.log(`**PASS** — matched ${matched} ≥ ${MATCH_FLOOR}`)
    process.exit(0)
  } else {
    console.log(`**FAIL** — matched ${matched} < ${MATCH_FLOOR}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
