/**
 * Charles W2.C regression repro — wire the real client-side CSV parse
 * + wizard column mapper + buildRecords logic against Charles's short
 * COG CSV and print a full mapping/record-count report.
 *
 * This script exists so that if Bug A or Bug B or Bug C regress in a
 * future commit, CI / manual repro will exit non-zero and surface the
 * failure without needing the wizard UI or a running Next.js server.
 *
 * Usage:
 *   bun scripts/repro-short-csv-import.ts
 *
 * Source priority for the CSV:
 *   1. $CHARLES_SHORT_CSV env var (an absolute path)
 *   2. /Users/vickkumar/Desktop/New New New Short.csv (dev-laptop default)
 *   3. scripts/fixtures/charles-short-cog.csv (repo fallback, committed so
 *      CI can run without access to Charles's desktop).
 */
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { localMapColumns } from "@/lib/map-columns"
import type { COGRecordInput } from "@/lib/validators/cog-records"

// ─── Wizard parity: same TARGET_FIELDS hooks/use-cog-import.ts uses ──
const TARGET_FIELDS = [
  { key: "inventoryNumber", label: "Inventory Number", required: true },
  { key: "inventoryDescription", label: "Description", required: true },
  { key: "vendorName", label: "Vendor Name", required: false },
  { key: "vendorItemNo", label: "Vendor Item No", required: false },
  { key: "manufacturerNo", label: "Manufacturer No", required: false },
  { key: "unitCost", label: "Unit Cost", required: true },
  { key: "extendedPrice", label: "Extended Price", required: false },
  { key: "quantity", label: "Quantity", required: false },
  { key: "transactionDate", label: "Transaction Date", required: true },
  { key: "category", label: "Category", required: false },
] as const

// ─── Wizard parity: inline copy of parseCsvText from hooks/use-file-parser.ts.
// (The hook is "use client" so we can't import it in node — but the
// text-parsing logic is pure and doesn't need React state.)
function parseCsvText(text: string): {
  headers: string[]
  rows: Record<string, string>[]
} {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")
  if (lines.length === 0) throw new Error("File contains no data")

  function splitCsvLine(line: string): string[] {
    const result: string[] = []
    let current = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === "," && !inQuotes) {
        result.push(current.trim())
        current = ""
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  // Strip BOM from first header if present (Excel exports add ﻿).
  const firstLine = lines[0]!.replace(/^﻿/, "")
  const headers = splitCsvLine(firstLine)
  if (headers.length === 0 || headers.every((h) => h === ""))
    throw new Error("No headers found in first row")

  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]!)
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (!header) return
      record[header] = values[index] ?? ""
    })
    rows.push(record)
  }

  if (rows.length === 0) throw new Error("File contains no data rows")
  return { headers: headers.filter((h) => h !== ""), rows }
}

// ─── Wizard parity: inline copy of buildRecords from hooks/use-cog-import.ts.
function buildRecords(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
): { records: COGRecordInput[]; dropped: { index: number; reason: string }[] } {
  const dropped: { index: number; reason: string }[] = []
  const records: COGRecordInput[] = []

  rows.forEach((row, index) => {
    const rawQty = mapping.quantity
      ? parseInt(row[mapping.quantity] ?? "", 10)
      : 1
    const qty = Number.isFinite(rawQty) && rawQty >= 1 ? rawQty : 1

    const rawUnitCost = parseFloat(
      (row[mapping.unitCost ?? ""] ?? "0").replace(/[^0-9.-]/g, ""),
    )
    const unitCost = Number.isFinite(rawUnitCost) ? rawUnitCost : 0

    let extendedPrice: number | undefined
    if (mapping.extendedPrice) {
      const rawExt = parseFloat(
        (row[mapping.extendedPrice] ?? "0").replace(/[^0-9.-]/g, ""),
      )
      extendedPrice =
        Number.isFinite(rawExt) && rawExt !== 0 ? rawExt : undefined
    }
    if (extendedPrice === undefined && unitCost > 0) {
      extendedPrice = unitCost * qty
    }

    const rawDate = (row[mapping.transactionDate ?? ""] ?? "").trim()
    let transactionDate = rawDate
    if (rawDate) {
      const d = new Date(rawDate)
      if (!isNaN(d.getTime())) {
        transactionDate = d.toISOString().slice(0, 10)
      }
    }

    const candidate: COGRecordInput = {
      inventoryNumber: row[mapping.inventoryNumber ?? ""] ?? "",
      inventoryDescription: row[mapping.inventoryDescription ?? ""] ?? "",
      vendorName: row[mapping.vendorName ?? ""] || undefined,
      vendorItemNo: row[mapping.vendorItemNo ?? ""] || undefined,
      manufacturerNo: row[mapping.manufacturerNo ?? ""] || undefined,
      unitCost,
      extendedPrice,
      quantity: qty,
      transactionDate,
      category: row[mapping.category ?? ""] || undefined,
    }

    // Mirror the filter in useCOGImport.buildRecords.
    if (!candidate.inventoryNumber) {
      dropped.push({ index, reason: "inventoryNumber empty" })
      return
    }
    if (!candidate.inventoryDescription) {
      dropped.push({ index, reason: "inventoryDescription empty" })
      return
    }
    if (!(candidate.unitCost > 0)) {
      dropped.push({ index, reason: `unitCost not > 0 (got ${candidate.unitCost})` })
      return
    }
    if (!candidate.transactionDate) {
      dropped.push({ index, reason: "transactionDate empty" })
      return
    }
    records.push(candidate)
  })

  return { records, dropped }
}

function resolveCsvPath(): string {
  const envPath = process.env.CHARLES_SHORT_CSV
  if (envPath && existsSync(envPath)) return envPath
  const desktop = "/Users/vickkumar/Desktop/New New New Short.csv"
  if (existsSync(desktop)) return desktop
  const fixture = resolve(
    __dirname,
    "fixtures",
    "charles-short-cog.csv",
  )
  if (existsSync(fixture)) return fixture
  throw new Error(
    `Cannot find Charles short CSV. Tried: $CHARLES_SHORT_CSV, ${desktop}, ${fixture}`,
  )
}

function main() {
  const csvPath = resolveCsvPath()
  const text = readFileSync(csvPath, "utf8")

  console.log("# Charles W2.C short-CSV import repro")
  console.log()
  console.log(`source: ${csvPath}`)
  console.log()

  const { headers, rows } = parseCsvText(text)
  console.log(`rows parsed: ${rows.length}`)
  console.log(`headers (${headers.length}):`)
  headers.forEach((h) => console.log(`  - ${h}`))
  console.log()

  const mapping = localMapColumns(headers, [...TARGET_FIELDS])
  console.log("mapping by field:")
  for (const field of TARGET_FIELDS) {
    const mapped = mapping[field.key]
    const flag = field.required ? "*" : " "
    console.log(`  ${flag} ${field.key.padEnd(22)} -> ${mapped ?? "(none)"}`)
  }
  console.log()

  // Check required fields first — if any REQUIRED key isn't mapped, the
  // wizard wouldn't let the user advance, so record-building would fail
  // silently.
  const missingRequired = TARGET_FIELDS
    .filter((f) => f.required)
    .filter((f) => !mapping[f.key])
    .map((f) => f.key)
  if (missingRequired.length > 0) {
    console.log(
      `FAIL: missing REQUIRED mapping(s): ${missingRequired.join(", ")}`,
    )
    process.exit(1)
  }

  const { records, dropped } = buildRecords(rows, mapping)
  console.log(`records built: ${records.length}`)
  console.log(`records filtered out: ${dropped.length}`)
  if (dropped.length > 0) {
    console.log()
    console.log("first 5 drops:")
    for (const d of dropped.slice(0, 5)) {
      console.log(`  row ${d.index}: ${d.reason}`)
    }
  }
  console.log()

  // Accept a few legitimate drops (e.g. blank trailing rows). 145 data
  // rows in the short CSV; 140 is a comfortable floor.
  const THRESHOLD = 140
  if (records.length < THRESHOLD) {
    console.log(
      `FAIL: only ${records.length} records built, threshold is ${THRESHOLD}`,
    )
    process.exit(1)
  }
  console.log(
    `OK: ${records.length} records built (threshold ${THRESHOLD})`,
  )
  process.exit(0)
}

main()
