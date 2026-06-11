/**
 * Regression tests for the prospective-analysis pricing-file reader.
 *
 * Bug 2026-06-10 (Vick, "Analysis for price not working"): the proposal
 * analyzer's price-file ask rejected the Arthrex demo file
 * (Cogsart01012024 Price file copy.xlsx) with "No items found in the
 * price file" because pricingRowsToItems hand-rolled a 7-alias SKU
 * header list that missed "ReferenceNumber". The canonical detector in
 * lib/utils/parse-pricing-file.ts already knew that alias (plus the
 * Stryker "Catalog Item", DePuy "PROD CD", and SYK "Reference numer"
 * typo variants) — the reader must reuse the canonical alias lists so
 * the two surfaces cannot drift.
 */

import { describe, expect, it } from "vitest"
import { pricingRowsToItems } from "../pricing-file-reader"

function rowsFor(
  headers: string[],
  data: string[][],
): Record<string, string>[] {
  return data.map((vals) => {
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? ""
    })
    return row
  })
}

describe("pricingRowsToItems — SKU header aliases", () => {
  it("matches the Arthrex 'ReferenceNumber' header (real-world regression)", () => {
    // Exact header row /api/parse-file returns for the Arthrex demo file.
    const headers = ["ReferenceNumber", "Description", "Product Catgory", "UOM", "Price"]
    const items = pricingRowsToItems(
      headers,
      rowsFor(headers, [
        ["6-820-00", "NTI Gas Warmer", "Joints-Ortho", "EA", "3360.00"],
        ["AR-9835", "Apollo RF H50", "Joints-Ortho", "EA", "260.00"],
      ]),
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      itemNumber: "6-820-00",
      description: "NTI Gas Warmer",
      proposedPrice: 3360,
    })
  })

  it.each([
    ["Catalog Item"], // Stryker joint price files (Charles 2026-06-07)
    ["PROD CD"], // DePuy export (Vick 2026-05-30)
    ["Reference numer"], // SYK carve-out workbook header typo (Bug B 2026-05-25)
    ["Part Number"],
    ["Item No"],
  ])("matches the canonical-list alias %s", (skuHeader) => {
    const headers = [skuHeader, "Description", "Price"]
    const items = pricingRowsToItems(
      headers,
      rowsFor(headers, [["SKU-1", "Widget", "10.00"]]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.itemNumber).toBe("SKU-1")
  })

  it("still returns [] when no SKU-like column exists", () => {
    const headers = ["Foo", "Bar"]
    expect(pricingRowsToItems(headers, rowsFor(headers, [["a", "b"]]))).toEqual([])
  })
})

describe("pricingRowsToItems — proposed vs current price", () => {
  it("keeps Proposed Price and Current Price on separate columns", () => {
    const headers = ["Item No", "Proposed Price", "Current Price", "Qty"]
    const items = pricingRowsToItems(
      headers,
      rowsFor(headers, [["SKU-1", "9.00", "10.00", "120"]]),
    )
    expect(items[0]).toMatchObject({
      itemNumber: "SKU-1",
      proposedPrice: 9,
      currentPrice: 10,
      estimatedAnnualQty: 120,
    })
  })

  it("does not let a generic 'Price' column double as both proposed and current", () => {
    // "cost" is a current-price alias; "price" is proposed. A file with
    // both must not map them to the same column.
    const headers = ["Item No", "Price", "Cost"]
    const items = pricingRowsToItems(
      headers,
      rowsFor(headers, [["SKU-1", "9.00", "10.00"]]),
    )
    expect(items[0]).toMatchObject({ proposedPrice: 9, currentPrice: 10 })
  })

  it("treats a lone 'Cost' column as current price, not proposed", () => {
    const headers = ["Item No", "Cost"]
    const items = pricingRowsToItems(
      headers,
      rowsFor(headers, [["SKU-1", "10.00"]]),
    )
    expect(items[0]!.currentPrice).toBe(10)
    expect(items[0]!.proposedPrice).toBe(0)
  })
})
