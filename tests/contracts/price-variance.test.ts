import { describe, it, expect } from "vitest"
import {
  calculatePriceVariance,
  analyzePriceDiscrepancies,
  type InvoiceLineForVariance,
  type ContractPriceLookup,
} from "@/lib/contracts/price-variance"

// Severity bands aligned 2026-04-23 to v0 spec:
//   |variance| ≤ 2  → acceptable
//   |variance| ≤ 5  → warning
//   |variance| >  5 → critical
describe("calculatePriceVariance", () => {
  it("at contract price: 0 variance, at_price, acceptable, 0 impact", () => {
    const r = calculatePriceVariance(100, 100, 10)
    expect(r.variancePercent).toBe(0)
    expect(r.direction).toBe("at_price")
    expect(r.severity).toBe("acceptable")
    expect(r.dollarImpact).toBe(0)
  })

  it("overcharge of 5% is warning severity (boundary)", () => {
    const r = calculatePriceVariance(105, 100, 10)
    expect(r.variancePercent).toBe(5)
    expect(r.direction).toBe("overcharge")
    expect(r.severity).toBe("warning")
    expect(r.dollarImpact).toBe(50)
  })

  it("overcharge of 12% is critical severity", () => {
    const r = calculatePriceVariance(112, 100, 5)
    expect(r.variancePercent).toBe(12)
    expect(r.severity).toBe("critical")
    expect(r.dollarImpact).toBe(60)
  })

  it("undercharge is negative dollarImpact and undercharge direction", () => {
    const r = calculatePriceVariance(95, 100, 10)
    expect(r.variancePercent).toBe(-5)
    expect(r.direction).toBe("undercharge")
    expect(r.dollarImpact).toBe(-50)
  })

  it("tiny overcharge (≤2%) is acceptable", () => {
    const r = calculatePriceVariance(101, 100, 1)
    expect(r.severity).toBe("acceptable")
  })

  it("contract price 0 is treated as at_price acceptable 0", () => {
    const r = calculatePriceVariance(100, 0, 1)
    expect(r.direction).toBe("at_price")
    expect(r.dollarImpact).toBe(0)
    expect(r.severity).toBe("acceptable")
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
    expect(r.bySeverity.critical).toBe(0)
  })

  it("aggregates overcharge and undercharge totals with severity counts (v0 bands)", () => {
    // Severity bands aligned 2026-04-23 to v0 spec:
    // |variance| ≤ 2%  → acceptable
    // |variance| ≤ 5%  → warning
    // |variance| >  5% → critical
    const lines: InvoiceLineForVariance[] = [
      { id: "l1", contractId: "c1", vendorItemNo: "SKU-A", actualPrice: 110, quantity: 10 }, // +10% critical
      { id: "l2", contractId: "c1", vendorItemNo: "SKU-A", actualPrice: 104, quantity: 5 },  //  +4% warning
      { id: "l3", contractId: "c1", vendorItemNo: "SKU-B", actualPrice: 45, quantity: 2 },   // -10% critical
      { id: "l4", contractId: "c1", vendorItemNo: "SKU-Z", actualPrice: 80, quantity: 1 },   // skipped
    ]
    const r = analyzePriceDiscrepancies(lines, priceLookup)
    expect(r.totalLines).toBe(3) // SKU-Z skipped
    expect(r.overchargeTotal).toBe(100 + 20)
    expect(r.underchargeTotal).toBe(-10)
    expect(r.bySeverity.critical).toBe(2)
    expect(r.bySeverity.warning).toBe(1)
    expect(r.lines[0].severity).toBe("critical")
  })
})
