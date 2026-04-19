/**
 * Pure-logic tests for the SpecificItemsPicker helpers — toggle and filter.
 * The picker itself is a thin shadcn UI shell over these two functions, so
 * locking in the logic here is enough to prevent regressions.
 */
import { describe, it, expect } from "vitest"
import {
  toggleVendorItem,
  filterVendorItems,
  type VendorItem,
} from "@/components/contracts/specific-items-picker"

const items: VendorItem[] = [
  { vendorItemNo: "STK-001", description: "Stryker plate, 6-hole" },
  { vendorItemNo: "STK-002", description: "Stryker plate, 8-hole" },
  { vendorItemNo: "MDT-100", description: null },
]

describe("toggleVendorItem", () => {
  it("adds an unselected item", () => {
    expect(toggleVendorItem([], "STK-001")).toEqual(["STK-001"])
  })

  it("removes an already-selected item", () => {
    expect(toggleVendorItem(["STK-001", "MDT-100"], "STK-001")).toEqual(["MDT-100"])
  })
})

describe("filterVendorItems", () => {
  it("returns everything when filter is empty", () => {
    expect(filterVendorItems(items, "")).toHaveLength(3)
    expect(filterVendorItems(items, "   ")).toHaveLength(3)
  })

  it("matches on vendorItemNo (case insensitive)", () => {
    expect(filterVendorItems(items, "stk")).toHaveLength(2)
    expect(filterVendorItems(items, "MDT")).toHaveLength(1)
  })

  it("matches on description when present", () => {
    expect(filterVendorItems(items, "8-hole")).toHaveLength(1)
    expect(filterVendorItems(items, "8-hole")[0].vendorItemNo).toBe("STK-002")
  })

  it("ignores items with no description match and no number match", () => {
    expect(filterVendorItems(items, "zzz")).toHaveLength(0)
  })
})
