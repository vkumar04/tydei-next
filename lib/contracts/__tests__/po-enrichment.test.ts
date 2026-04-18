import { describe, it, expect } from "vitest"
import {
  enrichPOLines,
  type ContractPriceLookupEntry,
  type POLineInput,
} from "../po-enrichment"

const pricing: ContractPriceLookupEntry[] = [
  { vendorItemNo: "ITEM-100", unitPrice: 100 },
  { vendorItemNo: "ITEM-200", unitPrice: 50 },
]

describe("enrichPOLines", () => {
  it("returns an empty array when given no lines", () => {
    const out = enrichPOLines({ lines: [], pricingItems: pricing })
    expect(out).toEqual([])
  })

  it("enriches a single on-contract line at exactly the contract price", () => {
    const lines: POLineInput[] = [
      { id: "l1", vendorItemNo: "ITEM-100", unitPrice: 100, quantity: 5 },
    ]
    const [row] = enrichPOLines({ lines, pricingItems: pricing })
    expect(row).toBeDefined()
    expect(row!.isOnContract).toBe(true)
    expect(row!.contractPrice).toBe(100)
    expect(row!.variance).toBe(0)
    expect(row!.variancePercent).toBe(0)
    expect(row!.severity).toBe("minor")
  })

  it("marks a line off-contract when vendorItemNo is not in the lookup", () => {
    const lines: POLineInput[] = [
      { id: "l1", vendorItemNo: "UNKNOWN-1", unitPrice: 99, quantity: 2 },
    ]
    const [row] = enrichPOLines({ lines, pricingItems: pricing })
    expect(row!.isOnContract).toBe(false)
    expect(row!.contractPrice).toBeNull()
    expect(row!.variance).toBeNull()
    expect(row!.variancePercent).toBeNull()
    expect(row!.severity).toBeNull()
  })

  it("matches vendorItemNo case-insensitively", () => {
    const lines: POLineInput[] = [
      { id: "l1", vendorItemNo: "item-100", unitPrice: 100, quantity: 1 },
    ]
    const [row] = enrichPOLines({ lines, pricingItems: pricing })
    expect(row!.isOnContract).toBe(true)
    expect(row!.contractPrice).toBe(100)
  })

  it("treats null vendorItemNo as off-contract without variance", () => {
    const lines: POLineInput[] = [
      { id: "l1", vendorItemNo: null, unitPrice: 100, quantity: 1 },
    ]
    const [row] = enrichPOLines({ lines, pricingItems: pricing })
    expect(row!.isOnContract).toBe(false)
    expect(row!.contractPrice).toBeNull()
    expect(row!.variance).toBeNull()
    expect(row!.severity).toBeNull()
  })

  it("severity boundaries: 1% = minor, 5% = moderate, 15% = major", () => {
    const lines: POLineInput[] = [
      { id: "a", vendorItemNo: "ITEM-100", unitPrice: 101, quantity: 1 }, // +1%
      { id: "b", vendorItemNo: "ITEM-100", unitPrice: 105, quantity: 1 }, // +5%
      { id: "c", vendorItemNo: "ITEM-100", unitPrice: 115, quantity: 1 }, // +15%
    ]
    const rows = enrichPOLines({ lines, pricingItems: pricing })
    expect(rows[0]!.severity).toBe("minor")
    expect(rows[1]!.severity).toBe("moderate")
    expect(rows[2]!.severity).toBe("major")
  })

  it("preserves the sign of variance for overcharge vs undercharge", () => {
    const lines: POLineInput[] = [
      { id: "over", vendorItemNo: "ITEM-100", unitPrice: 110, quantity: 3 }, // +$10 × 3
      { id: "under", vendorItemNo: "ITEM-100", unitPrice: 90, quantity: 2 }, // -$10 × 2
    ]
    const [over, under] = enrichPOLines({ lines, pricingItems: pricing })
    expect(over!.variance).toBe(30)
    expect(over!.variancePercent).toBeCloseTo(10, 10)
    expect(under!.variance).toBe(-20)
    expect(under!.variancePercent).toBeCloseTo(-10, 10)
  })
})
