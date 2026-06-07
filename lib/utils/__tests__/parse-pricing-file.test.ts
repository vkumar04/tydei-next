import { describe, it, expect } from "vitest"
import {
  detectPricingColumnMapping,
  buildPricingItems,
  pricingNeedsManualMapping,
} from "@/lib/utils/parse-pricing-file"

describe("pricingNeedsManualMapping (category-realign trigger — Charles 2026-06-06)", () => {
  it("does NOT require manual mapping when a standard category column is detected", () => {
    const headers = ["vendor_item_no", "contract_price", "category"]
    const autoMap = detectPricingColumnMapping(headers)
    expect(pricingNeedsManualMapping(autoMap, headers)).toBe(false)
  })

  it("REQUIRES manual mapping when category is undetected but an unrecognized column exists", () => {
    // "Prod Line" is almost certainly the category but isn't a known alias.
    const headers = ["vendor_item_no", "contract_price", "Prod Line"]
    const autoMap = detectPricingColumnMapping(headers)
    expect(autoMap.category).toBeUndefined()
    // Without this, the realign dialog would never open and the category drops.
    expect(pricingNeedsManualMapping(autoMap, headers)).toBe(true)
  })

  it("does NOT add friction for a plain price list with no category and no spare columns", () => {
    const headers = ["vendor_item_no", "contract_price", "list_price", "uom"]
    const autoMap = detectPricingColumnMapping(headers)
    expect(autoMap.category).toBeUndefined()
    expect(pricingNeedsManualMapping(autoMap, headers)).toBe(false)
  })

  it("requires manual mapping when a required column (price) is missing", () => {
    const headers = ["vendor_item_no", "category"]
    const autoMap = detectPricingColumnMapping(headers)
    expect(pricingNeedsManualMapping(autoMap, headers)).toBe(true)
  })
})

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
