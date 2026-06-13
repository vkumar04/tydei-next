/**
 * Regression tests for the vendor proposal-builder file uploads
 * (bugs 2026-06-13, screenshots: "Pricing file must have a product name
 * or reference number column" / "Usage file must have a product name
 * column" on the REAL price/usage files).
 *
 * Root cause: file-handlers.ts hand-rolled both the file parsing
 * (FileReader.readAsText — XLSX impossible, no BOM strip, no CRLF
 * normalization) and a third copy of the header-alias lists, which
 * missed "ReferenceNumber"-class SKU headers. Column resolution must go
 * through the canonical lists in lib/utils/parse-pricing-file.ts
 * (invariants table: "Pricing-file header detection") and file reading
 * through the shared readPricingRows.
 */

import { describe, expect, it } from "vitest"
import { mapPricingRows, mapUsageRows, MAX_USAGE_ROWS } from "../file-handlers"
import { readPricingRows } from "@/components/facility/analysis/prospective/pricing-file-reader"

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

describe("mapPricingRows — canonical header detection", () => {
  it("parses the exact real-world header row (ReferenceNumber + ' Price')", () => {
    // The header row /api/parse-file returns for the Arthrex price file
    // — the one the 2026-06-13 screenshots show being rejected.
    const headers = ["ReferenceNumber", "Description", "Product Catgory", "UOM", " Price"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [
        ["6-820-00", "NTI Gas Warmer", "Joints-Ortho", "EA", "3360.00"],
        ["AR-9835", "Apollo RF H50", "Joints-Ortho", "EA", "$260.00"],
      ]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products).toHaveLength(2)
    expect(result.products[0]).toMatchObject({
      productName: "NTI Gas Warmer",
      refNumber: "6-820-00",
      proposedPrice: 3360,
      fromPricingFile: true,
    })
    // "$260.00" → 260 ($/comma stripping preserved)
    expect(result.products[1].proposedPrice).toBe(260)
    // "Product Catgory" (real-world typo header) resolves via the
    // canonical CATEGORY_ALIASES and is counted + detected.
    expect(result.distinctCategories).toEqual(["Joints-Ortho"])
    expect(result.detectedCategory).toBe("Joints-Ortho")
  })

  it("falls back to the ref number as the product name when no description column exists", () => {
    const headers = ["SKU", "Price", "Quantity"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [["AR-1", "100", "5"]]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products[0]).toMatchObject({
      productName: "AR-1",
      refNumber: "AR-1",
      proposedPrice: 100,
      projectedVolume: 5,
    })
    expect(result.totalSpend).toBe(500)
    expect(result.totalVolume).toBe(5)
  })

  it("resolves builder-specific secondary aliases (Product Name, Proposed Price, Cost Basis)", () => {
    const headers = ["Product Name", "Proposed Price", "Cost Basis", "Qty"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [["Hip Stem", "1,200.50", "$800", "10"]]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products[0]).toMatchObject({
      productName: "Hip Stem",
      proposedPrice: 1200.5,
      costBasis: 800,
      projectedVolume: 10,
    })
  })

  it("returns ok:false when neither a name nor a ref column exists (toast path)", () => {
    const headers = ["Col A", "Col B"]
    const result = mapPricingRows(headers, rowsFor(headers, [["x", "y"]]))
    expect(result).toEqual({ ok: false, reason: "missing-name-and-ref" })
  })
})

describe("mapUsageRows — usage-file columns", () => {
  it("parses a usage-style header row with vendor/date/qty/unit cost", () => {
    const headers = ["Vendor", "Date Ordered", "Product Description", "ReferenceNumber", "Quantity", "Unit Cost"]
    const result = mapUsageRows(
      headers,
      rowsFor(headers, [
        ["Arthrex", "3/15/2025", "Apollo RF H50", "AR-9835", "2", "$260.00"],
        ["Arthrex", "3/22/2025", "Apollo RF H50", "AR-9835", "3", "260.00"],
        ["Arthrex", "2025-04-02", "Apollo RF H50", "AR-9835", "1", "260.00"],
      ]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // One product aggregated by ref, two months of usage.
    expect(result.products).toHaveLength(1)
    const p = result.products[0]
    expect(p).toMatchObject({
      productName: "Apollo RF H50",
      refNumber: "AR-9835",
      projectedVolume: 6,
      historicalAvgVolume: 6,
    })
    expect(p.monthlyUsage?.map((m) => m.month)).toEqual(["2025-03", "2025-04"])
    // No extended-cost column → revenue = unitCost * qty per tx.
    expect(p.monthlyUsage?.[0]).toMatchObject({ volume: 5, revenue: 1300 })
    expect(result.totalVolume).toBe(6)
    expect(result.totalRevenue).toBe(1560)
    expect(result.processedRows).toBe(3)
    expect(result.truncated).toBe(false)
  })

  it("prefers the extended-cost column for revenue when present", () => {
    const headers = ["Product Name", "Qty", "Unit Cost", "Extended Cost"]
    const result = mapUsageRows(
      headers,
      rowsFor(headers, [["Widget", "4", "10", "45.00"]]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalRevenue).toBe(45)
  })

  it("returns ok:false when no product name column exists (toast path)", () => {
    // Ref-only usage files fail the gate, as before the rewrite.
    const headers = ["ReferenceNumber", "Quantity", "Unit Cost"]
    const result = mapUsageRows(headers, rowsFor(headers, [["AR-1", "1", "10"]]))
    expect(result).toEqual({ ok: false, reason: "missing-name" })
  })

  it("caps parsed rows at MAX_USAGE_ROWS and flags truncation", () => {
    const headers = ["Product Name", "Qty", "Unit Cost"]
    const rows = rowsFor(
      headers,
      Array.from({ length: MAX_USAGE_ROWS + 5 }, (_, i) => [`P${i % 10}`, "1", "1"]),
    )
    const result = mapUsageRows(headers, rows)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truncated).toBe(true)
    expect(result.processedRows).toBe(MAX_USAGE_ROWS)
  })
})

describe("readPricingRows — CSV front-end the handlers now share", () => {
  it("strips the BOM and normalizes CRLF so the last column has no trailing \\r", async () => {
    const csv = "\uFEFFReferenceNumber,Description,Price\r\nAR-1,Widget,100\r\nAR-2,Gadget,200\r\n"
    const file = new File([csv], "usage.csv", { type: "text/csv" })
    const { headers, rows } = await readPricingRows(file)
    expect(headers).toEqual(["ReferenceNumber", "Description", "Price"])
    expect(rows[1]).toMatchObject({ Price: "200" })

    const mapped = mapPricingRows(headers, rows)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.products.map((p) => p.proposedPrice)).toEqual([100, 200])
  })

  it("parses .txt uploads as CSV (builder inputs accept .txt)", async () => {
    const file = new File(["Product Name,Price\nWidget,5\n"], "export.txt", { type: "text/plain" })
    const { headers, rows } = await readPricingRows(file)
    expect(headers).toEqual(["Product Name", "Price"])
    expect(rows).toHaveLength(1)
  })
})
