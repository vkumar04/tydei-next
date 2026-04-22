/**
 * Diagnostic: run the pure `matchCOGRecordToContract` matcher against
 * Charles's three source files (CSV POs + xlsx price catalog) and
 * compare its status distribution to the independent Python oracle's
 * ground truth.
 *
 * See docs/superpowers/diagnostics/2026-04-22-oracle-arthrex-cluster.md for the
 * oracle's expected counts (1,037 on_contract, 3,222 not_priced, 4,259 total).
 *
 * Usage:
 *   bun scripts/diagnose-matcher-against-oracle.ts \
 *     > docs/superpowers/diagnostics/2026-04-22-w2a1-matcher-vs-oracle.md
 *
 * Pure + offline: imports lib/contracts/match.ts (no DB, no server actions).
 */

import fs from "node:fs"
import ExcelJS from "exceljs"
import {
  matchCOGRecordToContract,
  PRICE_VARIANCE_THRESHOLD,
  type CogRecordForMatch,
  type ContractForMatch,
  type ContractPricingItemForMatch,
  type MatchResult,
} from "@/lib/contracts/match"

const CSV_PATH = "/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv"
const XLSX_PATH = "/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx"

const TEST_FACILITY = "TEST_FACILITY"
const TEST_VENDOR = "TEST_VENDOR"

/* ─────────────────────────────────────────────────────────────────────
 *   CSV parsing — handles quoted fields with embedded commas.
 *   The CSV is small enough (~31k rows) for a single in-memory pass.
 * ───────────────────────────────────────────────────────────────────── */

function parseCsvLine(line: string): string[] {
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
    } else {
      if (ch === '"') {
        inQ = true
      } else if (ch === ",") {
        out.push(cur)
        cur = ""
      } else {
        cur += ch
      }
    }
  }
  out.push(cur)
  return out
}

type CsvRow = {
  vendor: string
  poNumber: string
  dateOrdered: string
  productName: string
  productRef: string
  quantity: string
  conversionFactor: string
  unitCost: string
  extendedCost: string
}

function readCsv(path: string): CsvRow[] {
  const raw = fs.readFileSync(path, "utf8").replace(/^﻿/, "")
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
  const header = parseCsvLine(lines[0])
  const idx = (name: string): number => {
    const i = header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
    if (i === -1) throw new Error(`CSV header missing: ${name}`)
    return i
  }
  const iVendor = idx("Vendor")
  const iPo = idx("Purchase Order Number")
  const iDate = idx("Date Ordered")
  const iName = idx("product name")
  const iRef = idx("Product ref number")
  const iQty = idx("Quantity Ordered")
  const iCf = idx("Conversion Factor Ordered")
  const iCost = idx("Unit Cost")
  const iExt = idx("Extended Cost")
  const rows: CsvRow[] = []
  for (let n = 1; n < lines.length; n++) {
    const f = parseCsvLine(lines[n])
    rows.push({
      vendor: f[iVendor] ?? "",
      poNumber: f[iPo] ?? "",
      dateOrdered: f[iDate] ?? "",
      productName: f[iName] ?? "",
      productRef: f[iRef] ?? "",
      quantity: f[iQty] ?? "",
      conversionFactor: f[iCf] ?? "",
      unitCost: f[iCost] ?? "",
      extendedCost: f[iExt] ?? "",
    })
  }
  return rows
}

/* Parse M/D/YY or M/D/YYYY. Returns epoch-anchored UTC to avoid TZ drift. */
function parseUsDate(s: string): Date {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return new Date(Number.NaN)
  const mm = Number(m[1])
  const dd = Number(m[2])
  let yy = Number(m[3])
  if (yy < 100) yy += 2000
  return new Date(Date.UTC(yy, mm - 1, dd))
}

/* ─────────────────────────────────────────────────────────────────────
 *   xlsx parsing — Sheet1, row 1 is header starting at col D.
 *   values[3] = ReferenceNumber, values[7] = Price (per exceljs 1-indexed
 *   array layout with a null at index 0).
 * ───────────────────────────────────────────────────────────────────── */

async function readPricing(path: string): Promise<ContractPricingItemForMatch[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const ws = wb.worksheets[0]
  const items: ContractPricingItemForMatch[] = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).values as unknown[]
    const ref = v[3]
    const price = v[7]
    if (typeof ref !== "string" || ref.trim() === "") continue
    const unit = typeof price === "number" ? price : Number(price)
    if (!Number.isFinite(unit)) continue
    items.push({
      vendorItemNo: ref.trim(),
      unitPrice: unit,
      listPrice: unit,
    })
  }
  return items
}

/* ─────────────────────────────────────────────────────────────────────
 *   Main.
 * ───────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const csvRows = readCsv(CSV_PATH)
  const arthrex = csvRows.filter((r) => /arthrex/i.test(r.vendor))

  const pricing = await readPricing(XLSX_PATH)

  const contract: ContractForMatch = {
    id: "TEST_CONTRACT",
    vendorId: TEST_VENDOR,
    status: "active",
    effectiveDate: new Date(Date.UTC(2024, 0, 1)),
    expirationDate: new Date(Date.UTC(2027, 11, 31)),
    facilityIds: [TEST_FACILITY],
    pricingItems: pricing,
    // No terms → no category scope narrowing.
  }

  type RowResult = {
    csvRow: CsvRow
    result: MatchResult
    extendedCost: number
  }

  const results: RowResult[] = []
  const statusCounts = new Map<string, { rows: number; spend: number }>()
  for (const row of arthrex) {
    const txn = parseUsDate(row.dateOrdered)
    const record: CogRecordForMatch = {
      facilityId: TEST_FACILITY,
      vendorId: TEST_VENDOR,
      vendorName: row.vendor,
      vendorItemNo: row.productRef.trim() === "" ? null : row.productRef.trim(),
      unitCost: Number(row.unitCost),
      quantity: Number(row.quantity),
      transactionDate: txn,
    }
    const result = matchCOGRecordToContract(record, [contract])
    const ext = Number(row.extendedCost)
    const extendedCost = Number.isFinite(ext) ? ext : 0
    results.push({ csvRow: row, result, extendedCost })
    const cur = statusCounts.get(result.status) ?? { rows: 0, spend: 0 }
    cur.rows += 1
    cur.spend += extendedCost
    statusCounts.set(result.status, cur)
  }

  // Build a set of refs present in catalog (case-insensitive) so we can
  // tell which CSV rows the oracle considers "in-catalog".
  const catalogRefs = new Set<string>(
    pricing.map((p) => p.vendorItemNo.toLowerCase()),
  )
  const oracleInCatalog = (csvRef: string): boolean =>
    csvRef.trim() !== "" && catalogRefs.has(csvRef.trim().toLowerCase())

  // Oracle expectations (from 2026-04-22-oracle-arthrex-cluster.md).
  const ORACLE_ON_CONTRACT = 1037
  const ORACLE_ON_CONTRACT_SPEND = 1_829_277.4
  const ORACLE_NOT_PRICED = 3222
  const ORACLE_TOTAL = 4259

  const matcherOnContract = statusCounts.get("on_contract") ?? {
    rows: 0,
    spend: 0,
  }

  // Emit markdown report.
  const fmt = (n: number): string =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2 })
  const fmtMoney = (n: number): string =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const lines: string[] = []
  lines.push("# W2A1 — pure matcher vs. oracle (Arthrex cluster)")
  lines.push("")
  lines.push(`_Generated: ${new Date().toISOString()}_`)
  lines.push("")
  lines.push("## Inputs")
  lines.push("")
  lines.push(`- COG CSV: \`${CSV_PATH}\` (${csvRows.length} rows, ${arthrex.length} Arthrex)`)
  lines.push(`- Pricing xlsx: \`${XLSX_PATH}\` (${pricing.length} priced items)`)
  lines.push(`- Contract: synthetic ContractForMatch (active, 2024-01-01 → 2027-12-31, no term scope)`)
  lines.push(`- Facility scope: \`${TEST_FACILITY}\` / Vendor: \`${TEST_VENDOR}\``)
  lines.push("")
  lines.push("## 1. Matcher output distribution")
  lines.push("")
  lines.push("| status | rows | spend (extendedCost) |")
  lines.push("|---|---:|---:|")
  const allStatuses = Array.from(statusCounts.keys()).sort()
  for (const s of allStatuses) {
    const c = statusCounts.get(s)!
    lines.push(`| ${s} | ${fmt(c.rows)} | ${fmtMoney(c.spend)} |`)
  }
  const totalSpend = Array.from(statusCounts.values()).reduce(
    (a, b) => a + b.spend,
    0,
  )
  lines.push(`| **total** | **${fmt(arthrex.length)}** | **${fmtMoney(totalSpend)}** |`)
  lines.push("")

  lines.push("## 2. Oracle vs. matcher")
  lines.push("")
  lines.push("| bucket | oracle rows | matcher rows | delta | oracle spend | matcher spend | delta |")
  lines.push("|---|---:|---:|---:|---:|---:|---:|")
  lines.push(
    `| on_contract | ${fmt(ORACLE_ON_CONTRACT)} | ${fmt(matcherOnContract.rows)} | ${fmt(
      matcherOnContract.rows - ORACLE_ON_CONTRACT,
    )} | ${fmtMoney(ORACLE_ON_CONTRACT_SPEND)} | ${fmtMoney(matcherOnContract.spend)} | ${fmtMoney(
      matcherOnContract.spend - ORACLE_ON_CONTRACT_SPEND,
    )} |`,
  )
  const offCount =
    (statusCounts.get("off_contract_item")?.rows ?? 0) +
    (statusCounts.get("price_variance")?.rows ?? 0)
  lines.push(
    `| not_priced (off_contract_item + price_variance) | ${fmt(
      ORACLE_NOT_PRICED,
    )} | ${fmt(offCount)} | ${fmt(offCount - ORACLE_NOT_PRICED)} | — | — | — |`,
  )
  lines.push(
    `| total rows | ${fmt(ORACLE_TOTAL)} | ${fmt(arthrex.length)} | ${fmt(
      arthrex.length - ORACLE_TOTAL,
    )} | — | — | — |`,
  )
  lines.push("")

  // Disagreements: matcher says not on_contract, but catalog has the ref
  // (oracle would call it on_contract). Also the inverse (rare).
  type Disagreement = {
    kind: "matcher-missed" | "matcher-extra"
    csvRef: string
    productName: string
    unitCost: string
    quantity: string
    dateOrdered: string
    extended: number
    matcherStatus: string
    matcherReason?: string
    inCatalog: boolean
  }
  const disagreements: Disagreement[] = []
  for (const r of results) {
    const inCat = oracleInCatalog(r.csvRow.productRef)
    if (inCat && r.result.status !== "on_contract") {
      disagreements.push({
        kind: "matcher-missed",
        csvRef: r.csvRow.productRef,
        productName: r.csvRow.productName,
        unitCost: r.csvRow.unitCost,
        quantity: r.csvRow.quantity,
        dateOrdered: r.csvRow.dateOrdered,
        extended: r.extendedCost,
        matcherStatus: r.result.status,
        matcherReason:
          "reason" in r.result ? r.result.reason : undefined,
        inCatalog: true,
      })
    } else if (!inCat && r.result.status === "on_contract") {
      disagreements.push({
        kind: "matcher-extra",
        csvRef: r.csvRow.productRef,
        productName: r.csvRow.productName,
        unitCost: r.csvRow.unitCost,
        quantity: r.csvRow.quantity,
        dateOrdered: r.csvRow.dateOrdered,
        extended: r.extendedCost,
        matcherStatus: r.result.status,
        inCatalog: false,
      })
    }
  }

  lines.push("## 3. Disagreements")
  lines.push("")
  lines.push(
    `- matcher-missed (catalog has ref, matcher says ${"`"}!=on_contract${"`"}): **${fmt(
      disagreements.filter((d) => d.kind === "matcher-missed").length,
    )}**`,
  )
  lines.push(
    `- matcher-extra (catalog does NOT have ref, matcher says ${"`"}on_contract${"`"}): **${fmt(
      disagreements.filter((d) => d.kind === "matcher-extra").length,
    )}**`,
  )
  lines.push("")
  lines.push("### First 10 matcher-missed rows")
  lines.push("")
  lines.push("| csvRef | productName (40ch) | qty | unitCost | date | ext | matcherStatus | reason |")
  lines.push("|---|---|---:|---:|---|---:|---|---|")
  for (const d of disagreements
    .filter((d) => d.kind === "matcher-missed")
    .slice(0, 10)) {
    lines.push(
      `| \`${d.csvRef}\` | ${d.productName.slice(0, 40)} | ${d.quantity} | ${d.unitCost} | ${d.dateOrdered} | ${fmtMoney(d.extended)} | ${d.matcherStatus} | ${d.matcherReason ?? ""} |`,
    )
  }
  lines.push("")
  lines.push("### First 10 matcher-extra rows")
  lines.push("")
  lines.push("| csvRef | productName (40ch) | qty | unitCost | date | ext |")
  lines.push("|---|---|---:|---:|---|---:|")
  for (const d of disagreements
    .filter((d) => d.kind === "matcher-extra")
    .slice(0, 10)) {
    lines.push(
      `| \`${d.csvRef}\` | ${d.productName.slice(0, 40)} | ${d.quantity} | ${d.unitCost} | ${d.dateOrdered} | ${fmtMoney(d.extended)} |`,
    )
  }
  lines.push("")

  lines.push("## 4. Verdict")
  lines.push("")
  const delta = matcherOnContract.rows - ORACLE_ON_CONTRACT
  const pvCount = statusCounts.get("price_variance")?.rows ?? 0
  const inCatalogCount = matcherOnContract.rows + pvCount
  const refNormAgrees = Math.abs(inCatalogCount - ORACLE_ON_CONTRACT) <= 10
  if (refNormAgrees) {
    lines.push(
      `**Ref-normalization AGREES with oracle.** The pure matcher joins ${fmt(
        inCatalogCount,
      )} CSV rows against catalog refs (on_contract + price_variance), which matches the oracle's ${fmt(
        ORACLE_ON_CONTRACT,
      )} \`in-catalog\` rows. The ${fmt(
        pvCount,
      )}-row split between ${"`"}on_contract${"`"} and ${"`"}price_variance${"`"} is the matcher's \`PRICE_VARIANCE_THRESHOLD\` (${PRICE_VARIANCE_THRESHOLD}%) at work — the oracle doesn't model this threshold, so the row counts diverge on pricing variance but not on catalog membership.`,
    )
    lines.push("")
    lines.push(
      "**Conclusion:** the production bug (0 on_contract in the demo DB) is NOT in `lib/contracts/match.ts`. It lives downstream — recompute pipeline, vendor resolution during import, or the demo DB's COG rows never being enriched out of `pending`.",
    )
  } else {
    lines.push(
      "**Ref-normalization DISAGREES with oracle.** The pure matcher's ref-join differs from the oracle's by more than a handful of rows. The matcher itself has a normalization bug (case, whitespace, leading zeros, unicode dashes).",
    )
  }
  lines.push("")
  lines.push(
    `matcher on_contract = ${matcherOnContract.rows}, price_variance = ${pvCount}, in-catalog total = ${inCatalogCount}, oracle on_contract = ${ORACLE_ON_CONTRACT}, delta on_contract = ${delta}, delta in-catalog = ${inCatalogCount - ORACLE_ON_CONTRACT}.`,
  )
  lines.push("")

  process.stdout.write(lines.join("\n"))
}

await main()
