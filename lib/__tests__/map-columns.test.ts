/**
 * Tests for the wizard column mapper (`localMapColumns` / `mapColumns`)
 * in `lib/map-columns.ts`.
 *
 * Charles W2.C-A regression: Charles's short COG CSV uses "Vendor Item
 * Number" as the only item-identifier column. The wizard's
 * `TARGET_FIELDS` lists `inventoryNumber` as REQUIRED, so if the alias
 * map doesn't cover `vendoritemnumber`, `buildRecords()` filters every
 * row out and the server sees 0 records → 0 imported. This suite locks
 * the mapping for the headers in Charles's short CSV down so the
 * regression can't recur.
 */
import { describe, it, expect } from "vitest"

// Re-import the non-exported `localMapColumns` via test-only export.
// We expose it from the module for this test. If this import fails,
// update `lib/map-columns.ts` to export `localMapColumns` alongside
// `mapColumns` (the public API).
import { localMapColumns } from "@/lib/map-columns"

const WIZARD_TARGET_FIELDS = [
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

// Exactly the 11 headers from `/Users/vickkumar/Desktop/New New New Short.csv`.
const CHARLES_SHORT_HEADERS = [
  "Purchase Order Number",
  "Vendor",
  "Vendor Item Number",
  "Inventory Description",
  "Date Ordered",
  "Return Date",
  "Quantity Ordered",
  "UOM Ordered",
  "Conversion Factor Ordered",
  "Unit Cost",
  "Extended Cost",
]

describe("localMapColumns — Charles short COG CSV (W2.C-A)", () => {
  it("maps all four REQUIRED wizard fields to source headers", () => {
    const mapping = localMapColumns(CHARLES_SHORT_HEADERS, [
      ...WIZARD_TARGET_FIELDS,
    ])

    // Every required key must land on a non-empty source header.
    expect(mapping.inventoryNumber, "inventoryNumber").toBeTruthy()
    expect(mapping.inventoryDescription, "inventoryDescription").toBeTruthy()
    expect(mapping.unitCost, "unitCost").toBeTruthy()
    expect(mapping.transactionDate, "transactionDate").toBeTruthy()
  })

  it("maps inventoryNumber to 'Vendor Item Number' when that's the only item-identifier column", () => {
    const mapping = localMapColumns(CHARLES_SHORT_HEADERS, [
      ...WIZARD_TARGET_FIELDS,
    ])
    expect(mapping.inventoryNumber).toBe("Vendor Item Number")
  })

  it("maps transactionDate to 'Date Ordered'", () => {
    const mapping = localMapColumns(CHARLES_SHORT_HEADERS, [
      ...WIZARD_TARGET_FIELDS,
    ])
    expect(mapping.transactionDate).toBe("Date Ordered")
  })

  it("maps unitCost to 'Unit Cost' and inventoryDescription to 'Inventory Description'", () => {
    const mapping = localMapColumns(CHARLES_SHORT_HEADERS, [
      ...WIZARD_TARGET_FIELDS,
    ])
    expect(mapping.unitCost).toBe("Unit Cost")
    expect(mapping.inventoryDescription).toBe("Inventory Description")
  })
})
