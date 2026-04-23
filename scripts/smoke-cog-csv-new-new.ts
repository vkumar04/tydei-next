/**
 * Smoke: simulate mass-upload of Charles's "New New New Short.csv"
 * through the same parse + mapping + record-build pipeline the server
 * action uses — without hitting Prisma. Reports what would be imported
 * so we can confirm Bugs 13/14 root-cause vs downstream parser problems.
 */
import { readFileSync } from "node:fs"
import {
  localFallbackMap,
  parseCSV,
  parseMoney,
  parseDate,
  get,
} from "@/lib/actions/imports/shared"

const CSV_PATH = "/Users/vickkumar/Desktop/New New New Short.csv"

const targetFields = [
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

function main() {
  const text = readFileSync(CSV_PATH, "utf8")
  const rows = parseCSV(text)
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  console.log(`[smoke] headers: ${JSON.stringify(headers)}`)
  console.log(`[smoke] data rows: ${rows.length}`)

  const mapping = localFallbackMap(headers, targetFields)
  console.log(`[smoke] mapping:`, mapping)

  const unmappedRequired = targetFields
    .filter((f) => f.required && !mapping[f.key])
    .map((f) => f.key)
  if (unmappedRequired.length > 0) {
    console.log(`[smoke] UNMAPPED REQUIRED: ${unmappedRequired.join(", ")}`)
  }

  let skipped = 0
  let imported = 0
  let multiplierVariance = 0
  for (const row of rows) {
    const vendorName = get(row, mapping, "vendorName")
    const transactionDate = parseDate(get(row, mapping, "transactionDate"))
    if (!vendorName || !transactionDate) {
      skipped++
      continue
    }
    const quantity = parseInt(get(row, mapping, "quantity") || "1", 10) || 1
    const rawMultiplier = get(row, mapping, "multiplier")
    const multiplier = rawMultiplier
      ? parseFloat(rawMultiplier.replace(/[^0-9.]/g, "")) || 1
      : 1
    if (multiplier !== 1) multiplierVariance++
    const unitCost = parseMoney(get(row, mapping, "unitCost"))
    const explicitExtended = parseMoney(get(row, mapping, "extended"))
    const extended =
      explicitExtended > 0 ? explicitExtended : unitCost * quantity * multiplier
    if (imported < 3) {
      console.log(`[smoke] sample row ${imported + 1}:`, {
        vendor: vendorName,
        date: transactionDate.toISOString().slice(0, 10),
        qty: quantity,
        multiplier,
        unitCost,
        extended,
      })
    }
    imported++
  }
  console.log(`[smoke] imported=${imported} skipped=${skipped}`)
  console.log(
    `[smoke] rows with non-1 multiplier: ${multiplierVariance} / ${imported}`,
  )
}

main()
