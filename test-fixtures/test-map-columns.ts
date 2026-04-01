/**
 * E2E test for the AI column mapping + pricing import flow.
 *
 * Run: bun test-fixtures/test-map-columns.ts
 *
 * Requires the dev server running on localhost:3000 and a valid session cookie.
 * Alternatively, tests the API route directly.
 */

import { readFileSync } from "fs"
import { join } from "path"

const BASE = process.env.BASE_URL ?? "http://localhost:3000"

// Parse CSV into headers + rows
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split("\n")
  const headers = parseCSVLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const values = parseCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = values[i] ?? ""
    })
    return row
  })
  return { headers, rows }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes
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

// Expected mappings for each test file
const EXPECTED: Record<string, Record<string, string>> = {
  "stryker-pricing-nonstandard.csv": {
    vendorItemNo: "Supplier Part #",
    productDescription: "Material Desc",
    manufacturerNo: "Mfg Catalog No",
    listPrice: "MSRP",
    contractPrice: "Negotiated Unit Price",
    effectiveDate: "Contract Start",
    expirationDate: "Contract End",
    category: "Product Line",
    uom: "Pkg",
  },
  "medtronic-pricing-nonstandard.csv": {
    vendorItemNo: "Part Number",
    productDescription: "Item Name",
    manufacturerNo: "Mfr Part ID",
    listPrice: "Base Price",
    contractPrice: "Net Price",
    effectiveDate: "Valid From",
    expirationDate: "Valid Until",
    category: "Segment",
    uom: "Unit",
  },
}

const TARGET_FIELDS = [
  { key: "vendorItemNo", label: "Vendor Item No", required: true },
  { key: "productDescription", label: "Description", required: true },
  { key: "manufacturerNo", label: "Manufacturer No", required: false },
  { key: "listPrice", label: "List Price", required: false },
  { key: "contractPrice", label: "Contract Price", required: false },
  { key: "effectiveDate", label: "Effective Date", required: true },
  { key: "expirationDate", label: "Expiration Date", required: false },
  { key: "category", label: "Category", required: false },
  { key: "uom", label: "UOM", required: false },
]

async function testFile(filename: string) {
  const csv = readFileSync(join(__dirname, filename), "utf-8")
  const { headers, rows } = parseCSV(csv)
  const expected = EXPECTED[filename]

  console.log(`\n========== Testing: ${filename} ==========`)
  console.log(`  Source headers: ${headers.join(", ")}`)
  console.log(`  Rows: ${rows.length}`)

  const res = await fetch(`${BASE}/api/ai/map-columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceHeaders: headers,
      targetFields: TARGET_FIELDS,
      sampleRows: rows.slice(0, 3),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`  FAIL: API returned ${res.status} — ${text}`)
    return false
  }

  const { mapping } = await res.json()
  console.log(`  AI Mapping result:`)

  let pass = true
  for (const field of TARGET_FIELDS) {
    const got = mapping[field.key] ?? "(unmapped)"
    const want = expected[field.key] ?? "(unmapped)"
    const ok = got === want
    if (!ok) pass = false
    console.log(`    ${ok ? "PASS" : "FAIL"} ${field.key}: "${got}" ${ok ? "===" : "!=="} "${want}"`)
  }

  // Now test that buildRecords would produce valid entries
  const records = rows.map((row) => {
    const rawLP = mapping.listPrice ? parseFloat((row[mapping.listPrice] ?? "0").replace(/[^0-9.-]/g, "")) : undefined
    const rawCP = mapping.contractPrice ? parseFloat((row[mapping.contractPrice] ?? "0").replace(/[^0-9.-]/g, "")) : undefined
    return {
      vendorItemNo: (row[mapping.vendorItemNo ?? ""] ?? "").trim(),
      productDescription: (row[mapping.productDescription ?? ""] ?? "").trim(),
      manufacturerNo: row[mapping.manufacturerNo ?? ""] || undefined,
      listPrice: rawLP && Number.isFinite(rawLP) ? rawLP : undefined,
      contractPrice: rawCP && Number.isFinite(rawCP) ? rawCP : undefined,
      effectiveDate: row[mapping.effectiveDate ?? ""] ?? "",
      category: row[mapping.category ?? ""] || undefined,
      uom: row[mapping.uom ?? ""] || "EA",
    }
  }).filter((r) => r.vendorItemNo && r.productDescription)

  console.log(`\n  Mapped records: ${records.length}/${rows.length}`)
  if (records.length === 0) {
    console.error("  FAIL: No records mapped — import would be empty!")
    pass = false
  } else {
    console.log(`  Sample record:`, JSON.stringify(records[0], null, 4))
    // Verify the values are reasonable
    const r = records[0]
    if (!r.vendorItemNo) { console.error("  FAIL: vendorItemNo is empty"); pass = false }
    if (!r.productDescription) { console.error("  FAIL: productDescription is empty"); pass = false }
    if (r.contractPrice && r.contractPrice <= 0) { console.error("  FAIL: contractPrice is <= 0"); pass = false }
  }

  return pass
}

async function main() {
  console.log("AI Column Mapping E2E Test")
  console.log(`Base URL: ${BASE}`)

  let allPass = true
  for (const file of Object.keys(EXPECTED)) {
    const ok = await testFile(file)
    if (!ok) allPass = false
  }

  console.log(`\n========== Summary ==========`)
  console.log(allPass ? "ALL TESTS PASSED" : "SOME TESTS FAILED")
  process.exit(allPass ? 0 : 1)
}

main()
