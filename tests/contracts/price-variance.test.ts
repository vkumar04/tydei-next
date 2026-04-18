import { describe, it, expect } from "vitest"
import {
  calculatePriceVariance,
  analyzePriceDiscrepancies,
  type InvoiceLineForVariance,
  type ContractPriceLookup,
} from "@/lib/contracts/price-variance"

describe("calculatePriceVariance", () => {
  it("at contract price: 0 variance, at_price, 0 impact", () => {
    const r = calculatePriceVariance(100, 100, 10)
    expect(r.variancePercent).toBe(0)
    expect(r.direction).toBe("at_price")
    expect(r.severity).toBe("minor")
    expect(r.dollarImpact).toBe(0)
  })

  it("overcharge of 5% is moderate severity", () => {
    const r = calculatePriceVariance(105, 100, 10)
    expect(r.variancePercent).toBe(5)
    expect(r.direction).toBe("overcharge")
    expect(r.severity).toBe("moderate")
    expect(r.dollarImpact).toBe(50) // (105-100) × 10 qty
  })

  it("overcharge of 12% is major severity", () => {
    const r = calculatePriceVariance(112, 100, 5)
    expect(r.variancePercent).toBe(12)
    expect(r.severity).toBe("major")
    expect(r.dollarImpact).toBe(60)
  })

  it("undercharge is negative dollarImpact and undercharge direction", () => {
    const r = calculatePriceVariance(95, 100, 10)
    expect(r.variancePercent).toBe(-5)
    expect(r.direction).toBe("undercharge")
    expect(r.dollarImpact).toBe(-50)
  })

  it("tiny overcharge (<2%) is minor", () => {
    const r = calculatePriceVariance(101, 100, 1)
    expect(r.severity).toBe("minor")
  })

  it("contract price 0 is treated as at_price minor 0", () => {
    const r = calculatePriceVariance(100, 0, 1)
    expect(r.direction).toBe("at_price")
    expect(r.dollarImpact).toBe(0)
    expect(r.severity).toBe("minor")
  })
})

describe("analyzePriceDiscrepancies", () => {
  const priceLookup: ContractPriceLookup = new Map([
    ["c1::SKU-A", 100],
    ["c1::SKU-B", 50],
  ])

  it("returns empty summary for empty input", () => {
    const r = analyzePriceDiscrepancies([], priceLookup)
    expect(r.totalLines).toBe(0)
    expect(r.overchargeTotal).toBe(0)
    expect(r.underchargeTotal).toBe(0)
    expect(r.bySeverity.major).toBe(0)
  })

  it("aggregates overcharge and undercharge totals with severity counts", () => {
    const lines: InvoiceLineForVariance[] = [
      { id: "l1", contractId: "c1", vendorItemNo: "SKU-A", actualPrice: 110, quantity: 10 }, // +10% major
      { id: "l2", contractId: "c1", vendorItemNo: "SKU-A", actualPrice: 104, quantity: 5 },  // +4% minor
      { id: "l3", contractId: "c1", vendorItemNo: "SKU-B", actualPrice: 45, quantity: 2 },   // -10% undercharge major
      { id: "l4", contractId: "c1", vendorItemNo: "SKU-Z", actualPrice: 80, quantity: 1 },   // no contract price → skipped
    ]
    const r = analyzePriceDiscrepancies(lines, priceLookup)
    expect(r.totalLines).toBe(3) // SKU-Z skipped
    expect(r.overchargeTotal).toBe(100 + 20) // (110-100)*10 + (104-100)*5
    expect(r.underchargeTotal).toBe(-10) // (45-50)*2
    expect(r.bySeverity.major).toBe(2)
    expect(r.bySeverity.moderate).toBe(1)
    expect(r.lines[0].severity).toBe("major")
  })
})
