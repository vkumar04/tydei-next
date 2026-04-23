/**
 * Smoke: simulate the /contracts/new hero drop-zone receiving an .xlsx
 * pricing file. Mirrors handlePricingUpload's xlsx branch end-to-end:
 *
 *   1. Parse the .xlsx the way /api/parse-file does (ExcelJS).
 *   2. Auto-detect the column mapping (detectPricingColumnMapping).
 *   3. Build ContractPricingItem[] (buildPricingItems).
 *
 * If steps 1-3 succeed, the hero → pricing-file path works; the
 * importContractPricing server action is separately covered by
 * e2e-synthetic-test.
 */
import { readFileSync } from "node:fs"
import ExcelJS from "exceljs"
import {
  buildPricingItems,
  detectPricingColumnMapping,
} from "@/lib/utils/parse-pricing-file"

const XLSX_PATH = "/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx"

async function main() {
  console.log(`[smoke] reading ${XLSX_PATH}`)
  const bytes = readFileSync(XLSX_PATH)

  const wb = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(bytes as any)
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error("no sheets")

  const headerRow = sheet.getRow(1)
  const rawValues = headerRow.values as (ExcelJS.CellValue | undefined)[]
  const rawHeaders: string[] = rawValues
    .slice(1)
    .map((v) => (v != null ? String(v).trim() : ""))
  console.log(`[smoke] headers (${rawHeaders.length}):`, rawHeaders)

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
  console.log(`[smoke] data rows parsed: ${dataRows.length}`)

  const mapping = detectPricingColumnMapping(rawHeaders)
  console.log(`[smoke] auto-mapping:`, mapping)

  const items = buildPricingItems(dataRows, rawHeaders, mapping)
  console.log(`[smoke] built pricing items: ${items.length}`)
  if (items.length > 0) {
    console.log(`[smoke] sample item:`, items[0])
    console.log(`[smoke] last item:`, items[items.length - 1])
  }

  const requiredFields = ["vendorItemNo"] as const
  const unmapped = requiredFields.filter((f) => !mapping[f])
  if (unmapped.length > 0) {
    console.error(`[smoke] FAIL — missing required mapping: ${unmapped.join(", ")}`)
    process.exit(1)
  }

  if (items.length === 0) {
    console.error("[smoke] FAIL — 0 pricing items built")
    process.exit(1)
  }

  console.log("[smoke] PASS — hero xlsx drop would stage", items.length, "items")
}

main().catch((err) => {
  console.error("[smoke] ERROR:", err)
  process.exit(1)
})
