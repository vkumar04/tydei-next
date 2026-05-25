import { describe, it, expect } from "vitest"
import {
  detectPricingColumnMapping,
  buildPricingItems,
} from "@/lib/utils/parse-pricing-file"

describe("detectPricingColumnMapping", () => {
  it("maps canonical snake_case headers", () => {
    const map = detectPricingColumnMapping([
      "vendor_item_no",
      "description",
      "contract_price",
      "list_price",
      "category",
      "uom",
    ])
    expect(map.vendorItemNo).toBe("vendor_item_no")
    expect(map.description).toBe("description")
    expect(map.unitPrice).toBe("contract_price")
    expect(map.listPrice).toBe("list_price")
    expect(map.category).toBe("category")
    expect(map.uom).toBe("uom")
  })

  it("maps real-world SYK Carve out headers (with typo + carve-out %)", () => {
    // Bug B 2026-05-25: the SYK Carve out workbook ships with the
    // header typo "Reference numer" (missing 'b') and a "Carve out %"
    // column. The pre-fix detector returned needsManualMapping=true
    // because neither matched any alias.
    const map = detectPricingColumnMapping([
      "Reference numer",
      "Description",
      "Price",
      "Carve out %",
      "Contract ID",
      "Facility",
      "Vendor",
      "Product Category",
    ])
    expect(map.vendorItemNo).toBe("Reference numer")
    expect(map.description).toBe("Description")
    expect(map.unitPrice).toBe("Price")
    expect(map.carveOutPercent).toBe("Carve out %")
    expect(map.category).toBe("Product Category")
  })

  it("populates carveOutPercent for the canonical aliases", () => {
    expect(detectPricingColumnMapping(["carve_out_percent"]).carveOutPercent).toBe(
      "carve_out_percent",
    )
    expect(detectPricingColumnMapping(["CarveOutPercentage"]).carveOutPercent).toBe(
      "CarveOutPercentage",
    )
  })

  it("returns an empty map when no headers match", () => {
    expect(detectPricingColumnMapping(["foo", "bar"])).toEqual({})
  })
})

describe("buildPricingItems", () => {
  it("propagates the carveOutPercent column to each item (0.12 → 0.12)", () => {
    // Pre-fix the autoMap never populated carveOutPercent, so every
    // imported row came back with carveOutPercent: undefined.
    const headers = ["Reference numer", "Price", "Carve out %"]
    const rows = [
      ["CAT01386", "330.65", "0.12"],
      ["CAT01373", "160.65", "0.12"],
    ]
    const map = detectPricingColumnMapping(headers)
    const items = buildPricingItems(rows, headers, map)
    expect(items).toHaveLength(2)
    expect(items[0]?.vendorItemNo).toBe("CAT01386")
    expect(items[0]?.unitPrice).toBe(330.65)
    expect(items[0]?.carveOutPercent).toBeCloseTo(0.12)
    expect(items[1]?.carveOutPercent).toBeCloseTo(0.12)
  })

  it("normalizes a percent-points style carve-out (12 → 0.12)", () => {
    const headers = ["Reference numer", "Price", "Carve out %"]
    const rows = [["CAT01386", "330.65", "12"]]
    const map = detectPricingColumnMapping(headers)
    const items = buildPricingItems(rows, headers, map)
    expect(items[0]?.carveOutPercent).toBeCloseTo(0.12)
  })
})
