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
