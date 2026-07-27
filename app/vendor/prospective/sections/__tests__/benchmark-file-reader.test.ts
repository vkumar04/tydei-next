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
import { resolveMapping } from "@/components/shared/uploads/field-spec"
import {
  mapBenchmarkRows,
  benchmarkCoverageGaps,
  buildBenchmarkTemplateCsv,
  BENCHMARK_UPLOAD_SPECS,
} from "../benchmark-file-reader"

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

  it("maps a 'Construct' product-identifier header (Charles's benchmark file, no Category column)", () => {
    // Charles's real Benchmarks.xlsx: the product id column is "Construct" and
    // there is NO Category column — verified on prod 2026-07-06.
    const headers = ["Construct", "National Avg Price"]
    const { items } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["Cemented Knee", "3300"]]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.vendorItemNo).toBe("Cemented Knee")
    expect(items[0]!.category).toBeUndefined()
  })

  it("prefers a real SKU column over 'Construct' when both are present", () => {
    // Canonical aliases win; "construct" is only the last-resort fallback.
    const headers = ["Item Number", "Construct", "National Avg Price"]
    const { items } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["SKU-99", "Cemented Knee", "3300"]]),
    )
    expect(items[0]!.vendorItemNo).toBe("SKU-99")
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

// ─── Per-field coverage (Charles 2026-07-27) ─────────────────────
// "Benchmarks still do not have all of the information as they should" was a
// TRANSPARENCY bug, not data loss: his workbook is two columns, so the
// distribution fields were never in the file. Coverage is what lets the
// Benchmarks surface say that out loud instead of rendering a wall of "—".
describe("mapBenchmarkRows — per-field coverage", () => {
  it("reports zero coverage for every column Charles's two-column file omits", () => {
    const headers = ["Construct", "National Avg Price"]
    const { items, coverage } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [
        ["Cemented Knee", "3300"],
        ["Cemented knee with top Poly", "3600"],
        ["Cemented with revision poly", "3750"],
        ["Press fit knee", "4200"],
      ]),
    )
    expect(items).toHaveLength(4)
    expect(coverage).toEqual({
      category: 0,
      nationalAvgPrice: 4,
      percentile25: 0,
      percentile50: 0,
      percentile75: 0,
      minPrice: 0,
      maxPrice: 0,
      sampleSize: 0,
    })
    expect(benchmarkCoverageGaps(coverage).map((g) => g.key)).toEqual([
      "category",
      "percentile25",
      "percentile50",
      "percentile75",
      "minPrice",
      "maxPrice",
      "sampleSize",
    ])
    // Labels come from the specs so the import copy names columns exactly as
    // the mapping dialog and the CSV template do.
    expect(benchmarkCoverageGaps(coverage).map((g) => g.label)).toEqual([
      "Category",
      "25th percentile price",
      "Median price (P50)",
      "75th percentile price",
      "Minimum price",
      "Maximum price",
      "Sample size",
    ])
  })

  it("reports full coverage — and no gaps — for a fully-populated file", () => {
    const headers = [
      "Item Number",
      "Description",
      "Category",
      "National Avg Price",
      "P25",
      "Median",
      "P75",
      "Min Price",
      "Max Price",
      "Sample Size",
      "As Of",
    ]
    const { items, coverage } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [
        ["AR-1", "Knee", "Joints", "3300", "3100", "3250", "3500", "2800", "4100", "120", "2026-01-15"],
        ["AR-2", "Hip", "Joints", "4200", "4000", "4150", "4400", "3700", "5000", "80", "2026-01-15"],
      ]),
    )
    expect(items).toHaveLength(2)
    expect(coverage).toEqual({
      category: 2,
      nationalAvgPrice: 2,
      percentile25: 2,
      percentile50: 2,
      percentile75: 2,
      minPrice: 2,
      maxPrice: 2,
      sampleSize: 2,
    })
    expect(benchmarkCoverageGaps(coverage)).toEqual([])
  })

  it("counts per row, not per column — a partly-filled column is not a gap", () => {
    const headers = ["Item Number", "National Avg Price", "P25", "Sample Size"]
    const { coverage } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [
        ["A-1", "10", "9", ""],
        ["A-2", "20", "", "50"],
      ]),
    )
    expect(coverage.percentile25).toBe(1)
    expect(coverage.sampleSize).toBe(1)
    expect(benchmarkCoverageGaps(coverage).map((g) => g.key)).toEqual([
      "category",
      "percentile50",
      "percentile75",
      "minPrice",
      "maxPrice",
    ])
  })

  it("counts only KEPT rows (a dropped no-price row contributes nothing)", () => {
    const headers = ["Item Number", "Category", "National Avg Price"]
    const { items, droppedNoPrice, coverage } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [
        ["B-1", "Joints", ""], // dropped: no price data
        ["B-2", "Joints", "10"],
      ]),
    )
    expect(items).toHaveLength(1)
    expect(droppedNoPrice).toBe(1)
    expect(coverage.category).toBe(1)
    expect(coverage.nationalAvgPrice).toBe(1)
  })

  it("honours a mappingOverride that marks a column 'Not in this file'", () => {
    const headers = ["Code", "Avg", "P25"]
    const { coverage } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["A-1", "10", "9"]]),
      {
        itemNumber: "Code",
        description: null,
        category: null,
        nationalAvgPrice: "Avg",
        percentile25: null, // user unmapped it — coverage must follow
        percentile50: null,
        percentile75: null,
        minPrice: null,
        maxPrice: null,
        sampleSize: null,
        dataDate: null,
      },
    )
    expect(coverage.nationalAvgPrice).toBe(1)
    expect(coverage.percentile25).toBe(0)
  })
})

describe("buildBenchmarkTemplateCsv", () => {
  it("emits one header row built from the spec labels (never a hand-kept copy)", () => {
    const csv = buildBenchmarkTemplateCsv()
    expect(csv.split("\n")).toHaveLength(1)
    expect(csv).toBe(
      BENCHMARK_UPLOAD_SPECS.map((s) => `"${s.label}"`).join(","),
    )
  })

  it("carries a column for every field the parser reads", () => {
    const csv = buildBenchmarkTemplateCsv()
    for (const spec of BENCHMARK_UPLOAD_SPECS) {
      expect(csv).toContain(spec.label)
    }
  })

  it("round-trips: the template's own headers auto-detect to every field", () => {
    // The whole point of generating the template from the specs — a vendor
    // who fills it in must never see a "column not found" gap.
    const headers = BENCHMARK_UPLOAD_SPECS.map((s) => s.label)
    const { items, coverage } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [
        ["AR-1", "Knee", "Joints", "3300", "3100", "3250", "3500", "2800", "4100", "120", "2026-01-15"],
      ]),
    )
    expect(items).toHaveLength(1)
    expect(benchmarkCoverageGaps(coverage)).toEqual([])
  })

  it("round-trips through the MAPPING DIALOG too — every field resolves exactly", () => {
    // The dialog resolves headers with resolveMapping, the mapper with its
    // own alias scan. A filled-in template must clear BOTH: an "exact" hit
    // on every field means no missing-column amber note and no fuzzy "best
    // guess — verify" badge on the way to Import.
    const headers = BENCHMARK_UPLOAD_SPECS.map((s) => s.label)
    const { mapping, missingRequired, provenance } = resolveMapping(
      headers,
      BENCHMARK_UPLOAD_SPECS,
    )
    expect(missingRequired).toEqual([])
    for (const spec of BENCHMARK_UPLOAD_SPECS) {
      expect(mapping[spec.key]).toBe(spec.label)
      expect(provenance[spec.key]).toBe("exact")
    }
  })

  it("a label alias never steals another field's column", () => {
    // withLabelAlias widens EVERY consumer's detection, and the percentile
    // labels differ by one character ("25th…" / "75th…"). A file carrying
    // only the P75 template column must leave P25 and the median unmapped
    // rather than claiming the nearest lookalike.
    const headers = ["Item number", "75th percentile price"]
    const { items, coverage } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["AR-1", "3500"]]),
    )
    expect(items[0]!.percentile75).toBe(3500)
    expect(items[0]!.percentile25).toBeUndefined()
    expect(items[0]!.percentile50).toBeUndefined()
    expect(coverage.percentile75).toBe(1)
    expect(coverage.percentile25).toBe(0)
  })
})

describe("mapBenchmarkRows — Charles's real header set (2026-07-07)", () => {
  it("maps Construct / National ASP / Hard Floor / Ceiling without an override", () => {
    // "Bottom not coming over": Hard Floor (the bottom of the range) silently
    // dropped because no min-price alias matched; National ASP likewise.
    const headers = ["Construct", "National ASP", "Hard Floor", "Ceiling"]
    const { items, withNationalAvg } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["Cemented Knee", "3300", "2800", "4100"]]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.vendorItemNo).toBe("Cemented Knee")
    expect(items[0]!.nationalAvgPrice).toBe(3300)
    expect(items[0]!.minPrice).toBe(2800)
    expect(items[0]!.maxPrice).toBe(4100)
    expect(withNationalAvg).toBe(1)
  })
})
