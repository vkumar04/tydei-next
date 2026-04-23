/**
 * Smoke: run every Charles test fixture through the same parse + mapping
 * pipeline the UI uses, and print a comparison report. Does NOT touch
 * Prisma. Purpose: give a deterministic "is the importer still working
 * on the files Charles uses?" signal that we can diff across branches.
 *
 * Covers:
 *   - experiment COG vendor short NEW.csv      → COG mass upload
 *   - New New New Short.csv                    → COG mass upload
 *   - New New New Short.csvf.csv               → COG mass upload (variant)
 *   - Cogsart01012024 Price file.xlsx          → pricing-file import
 *
 * Skipped (not a text format):
 *   - Arthrex Ada Format.numbers (Apple Numbers bundle)
 */
import { readFileSync, existsSync } from "node:fs"
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

interface CogReport {
  kind: "cog"
  file: string
  exists: boolean
  rows: number
  mappedKeys: string[]
  unmappedRequired: string[]
  imported: number
  skipped: number
  multiplierVariance: number
  sampleRow?: unknown
}

interface PricingReport {
  kind: "pricing"
  file: string
  exists: boolean
  rows: number
  mappedKeys: string[]
  imported: number
  sampleItem?: unknown
}

type Report = CogReport | PricingReport

function cogCsv(path: string): CogReport {
  if (!existsSync(path)) {
    return {
      kind: "cog",
      file: path,
      exists: false,
      rows: 0,
      mappedKeys: [],
      unmappedRequired: [],
      imported: 0,
      skipped: 0,
      multiplierVariance: 0,
    }
  }
  const text = readFileSync(path, "utf8")
  const rows = parseCSV(text)
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  const mapping = localFallbackMap(headers, COG_TARGETS)
  const unmappedRequired = COG_TARGETS.filter(
    (f) => f.required && !mapping[f.key],
  ).map((f) => f.key)

  let imported = 0
  let skipped = 0
  let multiplierVariance = 0
  let sampleRow: unknown = undefined
  for (const row of rows) {
    const vendorName = get(row, mapping, "vendorName")
    const transactionDate = parseDate(get(row, mapping, "transactionDate"))
    if (!vendorName || !transactionDate) {
      skipped++
      continue
    }
    const quantity = parseInt(get(row, mapping, "quantity") || "1", 10) || 1
    const rawMult = get(row, mapping, "multiplier")
    const multiplier = rawMult
      ? parseFloat(rawMult.replace(/[^0-9.]/g, "")) || 1
      : 1
    if (multiplier !== 1) multiplierVariance++
    const unitCost = parseMoney(get(row, mapping, "unitCost"))
    const explicit = parseMoney(get(row, mapping, "extended"))
    const extended = explicit > 0 ? explicit : unitCost * quantity * multiplier
    if (!sampleRow) {
      sampleRow = {
        vendor: vendorName,
        date: transactionDate.toISOString().slice(0, 10),
        qty: quantity,
        multiplier,
        unitCost,
        extended,
      }
    }
    imported++
  }
  return {
    kind: "cog",
    file: path,
    exists: true,
    rows: rows.length,
    mappedKeys: Object.keys(mapping),
    unmappedRequired,
    imported,
    skipped,
    multiplierVariance,
    sampleRow,
  }
}

async function pricingXlsx(path: string): Promise<PricingReport> {
  if (!existsSync(path)) {
    return {
      kind: "pricing",
      file: path,
      exists: false,
      rows: 0,
      mappedKeys: [],
      imported: 0,
    }
  }
  const bytes = readFileSync(path)
  const wb = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(bytes as any)
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error(`no sheets in ${path}`)

  const headerRow = sheet.getRow(1)
  const rawValues = headerRow.values as (ExcelJS.CellValue | undefined)[]
  const rawHeaders: string[] = rawValues
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
  const mapping = detectPricingColumnMapping(rawHeaders)
  const items = buildPricingItems(dataRows, rawHeaders, mapping)
  return {
    kind: "pricing",
    file: path,
    exists: true,
    rows: dataRows.length,
    mappedKeys: Object.keys(mapping),
    imported: items.length,
    sampleItem: items[0],
  }
}

async function main() {
  const fixtures = [
    "/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv",
    "/Users/vickkumar/Desktop/New New New Short.csv",
    "/Users/vickkumar/Desktop/New New New Short.csvf.csv",
  ]
  const pricing = "/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx"
  const numbersFile = "/Users/vickkumar/Desktop/Arthrex Ada Format.numbers"

  const reports: Report[] = []
  for (const f of fixtures) reports.push(cogCsv(f))
  reports.push(await pricingXlsx(pricing))

  console.log(`# Charles fixtures smoke\n`)
  for (const r of reports) {
    const name = r.file.split("/").pop()
    console.log(`## ${name}`)
    if (!r.exists) {
      console.log(`  ⚠ file missing on this machine`)
      console.log()
      continue
    }
    if (r.kind === "cog") {
      console.log(`  rows=${r.rows} imported=${r.imported} skipped=${r.skipped}`)
      console.log(`  mapped=${JSON.stringify(r.mappedKeys)}`)
      if (r.unmappedRequired.length > 0) {
        console.log(
          `  ❌ unmapped required fields: ${r.unmappedRequired.join(", ")}`,
        )
      }
      console.log(
        `  multiplier !=1 on ${r.multiplierVariance}/${r.imported} rows`,
      )
      if (r.sampleRow) console.log(`  sample:`, r.sampleRow)
    } else {
      console.log(`  rows=${r.rows} itemsBuilt=${r.imported}`)
      console.log(`  mapped=${JSON.stringify(r.mappedKeys)}`)
      if (r.sampleItem) console.log(`  sample:`, r.sampleItem)
    }
    console.log()
  }

  if (existsSync(numbersFile)) {
    console.log(`## Arthrex Ada Format.numbers`)
    console.log(
      `  ⚠ Apple Numbers bundle — skipped (not a plain-text format).`,
    )
    console.log(
      `  To include: export to .xlsx from Numbers, then re-run.`,
    )
  }

  const anyFailure = reports.some(
    (r) => r.exists && r.kind === "cog" && r.unmappedRequired.length > 0,
  )
  if (anyFailure) {
    console.log("RESULT: FAIL")
    process.exit(1)
  }
  console.log("RESULT: PASS")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
