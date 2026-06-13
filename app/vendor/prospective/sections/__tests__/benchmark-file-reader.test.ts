/**
 * Tests for the vendor Benchmarks-tab file reader
 * ("Need to be able to add data for the benchmarks", Vick 2026-06-12).
 *
 * The reader MUST resolve SKU/description/category columns through the
 * canonical alias lists in lib/utils/parse-pricing-file.ts (invariants
 * table: "Pricing-file header detection") — the ReferenceNumber case below
 * is the real-world regression that rule exists for.
 */

import { describe, expect, it } from "vitest"
import { mapBenchmarkRows } from "../benchmark-file-reader"

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

describe("mapBenchmarkRows — full benchmark file", () => {
  const headers = [
    "Item Number",
    "Description",
    "National Avg Price",
    "P25",
    "Median",
    "P75",
    "Sample Size",
    "As Of",
  ]

  it("maps every column of a real-world-ish header row", () => {
    const { items, withNationalAvg } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [
        ["AR-9835", "Apollo RF H50", "260.00", "240.00", "255.00", "275.00", "1250", "2026-01-15"],
      ]),
    )
    expect(items).toHaveLength(1)
    expect(withNationalAvg).toBe(1)
    expect(items[0]).toEqual({
      vendorItemNo: "AR-9835",
      description: "Apollo RF H50",
      category: undefined,
      nationalAvgPrice: 260,
      percentile25: 240,
      percentile50: 255, // "Median" header → percentile50
      percentile75: 275,
      minPrice: undefined,
      maxPrice: undefined,
      sampleSize: 1250,
      dataDate: "2026-01-15",
    })
  })

  it("parses $-and-comma prices and comma'd sample sizes", () => {
    const { items } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [
        ["6-820-00", "NTI Gas Warmer", "$3,360.00", "$3,100.50", "", "", "2,400", ""],
      ]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.nationalAvgPrice).toBe(3360)
    expect(items[0]!.percentile25).toBe(3100.5)
    expect(items[0]!.sampleSize).toBe(2400)
    expect(items[0]!.dataDate).toBeUndefined()
  })
})

describe("mapBenchmarkRows — canonical SKU aliases", () => {
  it("matches a ReferenceNumber-style SKU header (canonical-list regression)", () => {
    const headers = ["ReferenceNumber", "Description", "Benchmark Price"]
    const { items } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["AR-1320", "Suture Anchor", "112.40"]]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.vendorItemNo).toBe("AR-1320")
    expect(items[0]!.nationalAvgPrice).toBe(112.4)
  })

  it.each([["Catalog Item"], ["PROD CD"], ["Part Number"]])(
    "matches canonical alias %s",
    (skuHeader) => {
      const headers = [skuHeader, "Avg Price"]
      const { items } = mapBenchmarkRows(
        headers,
        rowsFor(headers, [["SKU-1", "10.00"]]),
      )
      expect(items).toHaveLength(1)
      expect(items[0]!.vendorItemNo).toBe("SKU-1")
    },
  )
})

describe("mapBenchmarkRows — column variants", () => {
  it("maps percentile_25 / 50th_percentile / max_price / min / n / data_date families", () => {
    const headers = [
      "SKU",
      "Product Category",
      "percentile_25",
      "50th_percentile",
      "Min Price",
      "Max Price",
      "n",
      "data_date",
    ]
    const { items } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [
        ["X-1", "Joints-Ortho", "10", "12", "8", "20", "33", "2025-12-31"],
      ]),
    )
    expect(items[0]).toMatchObject({
      vendorItemNo: "X-1",
      category: "Joints-Ortho",
      percentile25: 10,
      percentile50: 12,
      minPrice: 8,
      maxPrice: 20,
      sampleSize: 33,
      dataDate: "2025-12-31",
    })
  })

  it("falls back to the canonical unit-price aliases for the national average", () => {
    const headers = ["Item No", "Price"]
    const { items } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["A-1", "42.00"]]),
    )
    expect(items[0]!.nationalAvgPrice).toBe(42)
  })

  it("prefers the explicit national-average column over a generic Price column", () => {
    const headers = ["Item No", "Price", "National Average"]
    const { items } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["A-1", "42.00", "40.00"]]),
    )
    expect(items[0]!.nationalAvgPrice).toBe(40)
  })
})

describe("mapBenchmarkRows — row-drop rules", () => {
  it("drops rows without an item number", () => {
    const headers = ["Item Number", "National Avg Price"]
    const { items } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [
        ["", "10.00"],
        ["   ", "11.00"],
        ["B-2", "12.00"],
      ]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.vendorItemNo).toBe("B-2")
  })

  it("drops rows with an item number but no price-ish field, and counts them", () => {
    const headers = ["Item Number", "Description", "National Avg Price", "Sample Size"]
    const { items, droppedNoPrice, withNationalAvg } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [
        ["C-1", "Widget", "", "100"], // sample size alone is not price-ish
        ["C-2", "Gadget", "15.00", "50"],
      ]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.vendorItemNo).toBe("C-2")
    expect(droppedNoPrice).toBe(1)
    expect(withNationalAvg).toBe(1)
  })

  it("keeps a row whose only price-ish field is a percentile", () => {
    const headers = ["Item Number", "P75"]
    const { items, withNationalAvg } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["D-1", "99.99"]]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.percentile75).toBe(99.99)
    expect(withNationalAvg).toBe(0)
  })

  it("drops non-numeric price cells to undefined instead of NaN", () => {
    const headers = ["Item Number", "National Avg Price", "P25"]
    const { items } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["E-1", "N/A", "12.00"]]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.nationalAvgPrice).toBeUndefined()
    expect(items[0]!.percentile25).toBe(12)
  })
})

describe("mapBenchmarkRows — mappingOverride (uploader improvements 1, 2026-06-13)", () => {
  it("override wins over auto-detect", () => {
    // "SKU" would auto-detect as the item column; the user's mapping
    // points at "Internal Code" and maps the oddball "$ Avg" price.
    const headers = ["SKU", "Internal Code", "$ Avg"]
    const { items, withNationalAvg } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["WRONG-1", "RIGHT-1", "42.00"]]),
      {
        itemNumber: "Internal Code",
        description: null,
        category: null,
        nationalAvgPrice: "$ Avg",
        percentile25: null,
        percentile50: null,
        percentile75: null,
        minPrice: null,
        maxPrice: null,
        sampleSize: null,
        dataDate: null,
      },
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.vendorItemNo).toBe("RIGHT-1")
    expect(items[0]!.nationalAvgPrice).toBe(42)
    expect(withNationalAvg).toBe(1)
  })

  it("keeps the at-least-one-price rule under an override (rows without price drop)", () => {
    const headers = ["Code", "Avg"]
    const { items, droppedNoPrice } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["A-1", ""], ["A-2", "10"]]),
      {
        itemNumber: "Code",
        description: null,
        category: null,
        nationalAvgPrice: "Avg",
        percentile25: null,
        percentile50: null,
        percentile75: null,
        minPrice: null,
        maxPrice: null,
        sampleSize: null,
        dataDate: null,
      },
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.vendorItemNo).toBe("A-2")
    expect(droppedNoPrice).toBe(1)
  })
})
