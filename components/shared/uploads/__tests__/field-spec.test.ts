/**
 * resolveMapping unit tests (uploader improvements 1, 2026-06-13).
 *
 * The resolver is the auto-detection half of the shared
 * <PricingFileDropzone>: norm() convention (lowercase, strip
 * non-alphanumerics), first-alias-wins priority, spec-order header
 * claiming (exclusion), contains-fallback second pass, and the
 * missingRequired report that drives the mapping-dialog gating.
 */

import { describe, expect, it } from "vitest"
import {
  boundedDamerauLevenshtein,
  norm,
  overrideIndex,
  resolveMapping,
  type UploadFieldSpec,
} from "../field-spec"
import { ANALYZER_PRICE_FILE_SPECS } from "@/components/facility/analysis/prospective/pricing-file-reader"
import {
  BUILDER_USAGE_UPLOAD_SPECS,
  BUILDER_PRICING_UPLOAD_SPECS,
  validateBuilderPricingMapping,
} from "@/components/vendor/prospective/builder/file-handlers"
import { BENCHMARK_UPLOAD_SPECS } from "@/app/vendor/prospective/sections/benchmark-file-reader"

const spec = (over: Partial<UploadFieldSpec> & { key: string }): UploadFieldSpec => ({
  label: over.key,
  aliases: [],
  kind: "text",
  ...over,
})

describe("norm", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(norm("Vendor_Item-No.")).toBe("vendoritemno")
    expect(norm(" Price ")).toBe("price")
    expect(norm("25th Percentile")).toBe("25thpercentile")
  })
})

describe("resolveMapping — priority and claiming", () => {
  it("first alias wins over header order", () => {
    // "Item No" appears BEFORE "SKU" in the file, but "sku" is the
    // higher-priority alias — alias order beats header order.
    const { mapping } = resolveMapping(
      ["Item No", "SKU"],
      [spec({ key: "item", aliases: ["sku", "item_no"] })],
    )
    expect(mapping.item).toBe("SKU")
  })

  it("matches aliases through norm (case / punctuation / spacing)", () => {
    const { mapping } = resolveMapping(
      ["VENDOR ITEM NO.", "Unit-Price"],
      [
        spec({ key: "item", aliases: ["vendor_item_no"] }),
        spec({ key: "price", aliases: ["unit_price"], kind: "number" }),
      ],
    )
    expect(mapping).toEqual({ item: "VENDOR ITEM NO.", price: "Unit-Price" })
  })

  it("earlier specs claim headers so later specs can't double-map (analyzer current-vs-proposed)", () => {
    // Mirrors pricingRowsToItems' exclude convention: currentPrice
    // resolves first and claims "Cost"; proposedPrice (whose canonical
    // list ALSO contains "cost") must take the other price column.
    const { mapping } = resolveMapping(
      ["Item Number", "Cost", "Unit Price"],
      ANALYZER_PRICE_FILE_SPECS,
    )
    expect(mapping.itemNumber).toBe("Item Number")
    expect(mapping.currentPrice).toBe("Cost")
    expect(mapping.proposedPrice).toBe("Unit Price")
  })

  it("reports required fields that did not resolve", () => {
    const { mapping, missingRequired } = resolveMapping(
      ["Foo", "Bar"],
      [
        spec({ key: "item", aliases: ["sku"], required: true }),
        spec({ key: "desc", aliases: ["description"] }),
      ],
    )
    expect(mapping).toEqual({ item: null, desc: null })
    expect(missingRequired).toEqual(["item"])
  })

  it("ignores empty headers", () => {
    const { mapping } = resolveMapping(
      ["", "SKU"],
      [spec({ key: "item", aliases: ["sku"] })],
    )
    expect(mapping.item).toBe("SKU")
  })

  it("contains-fallback runs only after the exact pass, in spec order", () => {
    const specs = [
      spec({ key: "unitCost", aliases: ["unit_cost"], contains: ["price"] }),
      spec({ key: "name", aliases: [], contains: ["description"] }),
    ]
    const { mapping } = resolveMapping(["Invoice Price", "Item Description"], specs)
    expect(mapping.unitCost).toBe("Invoice Price")
    expect(mapping.name).toBe("Item Description")
  })
})

describe("resolveMapping — real-world header rows", () => {
  it("resolves the Arthrex proposal price-file headers (ReferenceNumber + ' Price')", () => {
    const headers = ["ReferenceNumber", "Description", "Product Catgory", "UOM", " Price"]
    const { mapping, missingRequired } = resolveMapping(
      headers,
      ANALYZER_PRICE_FILE_SPECS,
    )
    expect(mapping.itemNumber).toBe("ReferenceNumber")
    expect(mapping.description).toBe("Description")
    // " Price" is not a current-price alias — it lands on proposedPrice
    // via the canonical UNIT_PRICE_ALIASES.
    expect(mapping.currentPrice).toBeNull()
    expect(mapping.proposedPrice).toBe(" Price")
    expect(missingRequired).toEqual([])
  })

  it("resolves Charles's invoice export headers for the usage spec (ref needs manual mapping)", () => {
    const headers = [
      "Date Created", "Date Submitted", "Item Extended Cost", "Facility",
      "Facility Number", "Inventory Description", "Inventory Number",
      "Invoice Date", "Invoice Number", "Invoice Price", "Invoice Quantity",
      "Invoice Status", "Invoice Subtotal", "Invoice Total",
    ]
    const { mapping, missingRequired } = resolveMapping(
      headers,
      BUILDER_USAGE_UPLOAD_SPECS,
    )
    expect(mapping.name).toBe("Inventory Description")
    expect(mapping.date).toBe("Date Created")
    expect(mapping.qty).toBe("Invoice Quantity")
    expect(mapping.unitCost).toBe("Invoice Price")
    expect(mapping.extendedCost).toBe("Item Extended Cost")
    // "Inventory Number" matches no canonical SKU alias and no contains
    // needle — exactly the case the mapping dialog exists for: the user
    // maps it manually instead of silently losing the ref column.
    expect(mapping.ref).toBeNull()
    // name (the only required usage field) resolved, so the dialog
    // opens importable (green note absent — a field was unmapped).
    expect(missingRequired).toEqual([])
  })

  it("resolves the benchmark spec on a percentile-style file", () => {
    const headers = ["SKU", "Product Description", "National Avg Price", "P25", "Median", "P75", "Sample Size"]
    const { mapping, missingRequired } = resolveMapping(headers, BENCHMARK_UPLOAD_SPECS)
    expect(mapping.itemNumber).toBe("SKU")
    expect(mapping.description).toBe("Product Description")
    expect(mapping.nationalAvgPrice).toBe("National Avg Price")
    expect(mapping.percentile25).toBe("P25")
    expect(mapping.percentile50).toBe("Median")
    expect(mapping.percentile75).toBe("P75")
    expect(mapping.sampleSize).toBe("Sample Size")
    expect(missingRequired).toEqual([])
  })
})

describe("boundedDamerauLevenshtein (feature 3)", () => {
  it("counts substitution, insertion, deletion as 1 each", () => {
    expect(boundedDamerauLevenshtein("price", "pride", 2)).toBe(1) // sub
    expect(boundedDamerauLevenshtein("pric", "price", 2)).toBe(1) // insert
    expect(boundedDamerauLevenshtein("prices", "price", 2)).toBe(1) // delete
  })
  it("counts an adjacent transposition as 1 (Damerau), not 2", () => {
    // "Pirce" → "Price" is a single swap of adjacent chars.
    expect(boundedDamerauLevenshtein("pirce", "price", 2)).toBe(1)
    expect(boundedDamerauLevenshtein("referance", "reference", 2)).toBe(1)
  })
  it("returns 0 for identical strings", () => {
    expect(boundedDamerauLevenshtein("sku", "sku", 1)).toBe(0)
  })
  it("short-circuits past the bound (returns max+1)", () => {
    // Length gap alone exceeds the bound.
    expect(boundedDamerauLevenshtein("a", "abcdef", 2)).toBe(3)
    // Genuinely distant within reach of the bound check.
    expect(boundedDamerauLevenshtein("price", "qwxyz", 2)).toBe(3)
  })
})

describe("resolveMapping — provenance (feature 3)", () => {
  it("tags exact, contains, fuzzy, and null per field", () => {
    const specs = [
      spec({ key: "exactF", aliases: ["sku"] }),
      spec({ key: "containsF", aliases: ["nope"], contains: ["price"] }),
      spec({ key: "fuzzyF", aliases: ["reference"] }),
      spec({ key: "missingF", aliases: ["zzzzz"] }),
    ]
    const { mapping, provenance } = resolveMapping(
      ["SKU", "Invoice Price", "Referance", "Other"],
      specs,
    )
    expect(mapping.exactF).toBe("SKU")
    expect(mapping.containsF).toBe("Invoice Price")
    expect(mapping.fuzzyF).toBe("Referance")
    expect(mapping.missingF).toBeNull()
    expect(provenance).toEqual({
      exactF: "exact",
      containsF: "contains",
      fuzzyF: "fuzzy",
      missingF: null,
    })
  })
})

describe("resolveMapping — fuzzy fallback (feature 3)", () => {
  it("'Referance Number' fuzzy-resolves to itemNumber", () => {
    // norm("Referance Number") = "referancenumber" vs alias
    // "referencenumber" → single substitution (a→e), within ≤2.
    const { mapping, provenance } = resolveMapping(
      ["Referance Number", "Description", "Price"],
      ANALYZER_PRICE_FILE_SPECS,
    )
    expect(mapping.itemNumber).toBe("Referance Number")
    expect(provenance.itemNumber).toBe("fuzzy")
  })

  it("'Pric' fuzzy-resolves to a price field (distance 1)", () => {
    const specs = [spec({ key: "price", aliases: ["price"], kind: "number" })]
    const { mapping, provenance } = resolveMapping(["Pric"], specs)
    expect(mapping.price).toBe("Pric")
    expect(provenance.price).toBe("fuzzy")
  })

  it("refuses to guess through a within-field tie (two equidistant headers)", () => {
    // Both "Iten" and "Iten2"? No — craft two headers each distance 1 from
    // the alias "item": "iten" (sub) and "itme" (transposition). Tie → null.
    const specs = [spec({ key: "item", aliases: ["item"] })]
    const { mapping, provenance } = resolveMapping(["Iten", "Itme"], specs)
    expect(mapping.item).toBeNull()
    expect(provenance.item).toBeNull()
  })

  it("refuses to guess when two fields want the SAME header", () => {
    // "Referencs" is NOT an exact match for either field, but is distance 1
    // from both aliases ("reference" e→s, "referencd" d→s) — so both fields'
    // fuzzy pass wants the same column. Cross-field ambiguity → neither
    // claims it.
    const specs = [
      spec({ key: "a", aliases: ["reference"] }),
      spec({ key: "b", aliases: ["referencd"] }),
    ]
    const { mapping, provenance } = resolveMapping(["Referencs"], specs)
    expect(mapping.a).toBeNull()
    expect(mapping.b).toBeNull()
    expect(provenance.a).toBeNull()
    expect(provenance.b).toBeNull()
  })

  it("never fuzzy-matches aliases shorter than 4 chars", () => {
    // alias "qty" (len 3) must not fuzzy-match the near-miss "qtt".
    const specs = [spec({ key: "qty", aliases: ["qty"], kind: "number" })]
    const { mapping, provenance } = resolveMapping(["Qtt"], specs)
    expect(mapping.qty).toBeNull()
    expect(provenance.qty).toBeNull()
  })

  it("applies the tighter ≤1 threshold for aliases ≤6 chars", () => {
    // alias "price" (len 5): distance-2 "prdce" must NOT match.
    const specs = [spec({ key: "price", aliases: ["price"], kind: "number" })]
    expect(resolveMapping(["Prdcz"], specs).mapping.price).toBeNull()
    // distance-1 still matches.
    expect(resolveMapping(["Prize"], specs).mapping.price).toBe("Prize")
  })
})

describe("resolveMapping — real-world rows resolve EXACT/CONTAINS, not fuzzy (feature 3)", () => {
  it("ReferenceNumber + ' Price' (Arthrex) keep exact provenance", () => {
    const headers = ["ReferenceNumber", "Description", "Product Catgory", "UOM", " Price"]
    const { mapping, provenance } = resolveMapping(
      headers,
      ANALYZER_PRICE_FILE_SPECS,
    )
    expect(mapping.itemNumber).toBe("ReferenceNumber")
    expect(provenance.itemNumber).toBe("exact")
    // " Price" → proposedPrice via the canonical alias = exact, not fuzzy.
    expect(mapping.proposedPrice).toBe(" Price")
    expect(provenance.proposedPrice).toBe("exact")
  })

  it("Charles's invoice headers keep exact/contains, never fuzzy", () => {
    const headers = [
      "Date Created", "Date Submitted", "Item Extended Cost", "Facility",
      "Facility Number", "Inventory Description", "Inventory Number",
      "Invoice Date", "Invoice Number", "Invoice Price", "Invoice Quantity",
      "Invoice Status", "Invoice Subtotal", "Invoice Total",
    ]
    const { provenance } = resolveMapping(headers, BUILDER_USAGE_UPLOAD_SPECS)
    // Every field that resolved did so via exact or contains — no field
    // should be a fuzzy "best guess" on these well-formed headers.
    for (const value of Object.values(provenance)) {
      expect(value === null || value === "exact" || value === "contains").toBe(
        true,
      )
    }
  })
})

describe("validateBuilderPricingMapping — either-of rule", () => {
  it("rejects when BOTH name and ref are unmapped", () => {
    const base = Object.fromEntries(
      BUILDER_PRICING_UPLOAD_SPECS.map((s) => [s.key, null]),
    )
    expect(validateBuilderPricingMapping(base)).toMatch(/Product name or Reference number/)
    expect(validateBuilderPricingMapping({ ...base, name: "Product" })).toBeNull()
    expect(validateBuilderPricingMapping({ ...base, ref: "SKU" })).toBeNull()
  })
})

describe("overrideIndex", () => {
  it("maps a field to the user-picked header, null means unmapped", () => {
    const headers = ["A", "B", "C"]
    expect(overrideIndex(headers, { x: "B" }, "x")).toBe(1)
    expect(overrideIndex(headers, { x: null }, "x")).toBe(-1)
    expect(overrideIndex(headers, {}, "x")).toBe(-1)
    expect(overrideIndex(headers, { x: "Missing" }, "x")).toBe(-1)
  })
})
