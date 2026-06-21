import { describe, it, expect } from "vitest"
import { aggregateUploadedSpend } from "../uploaded-spend-to-analysis-data"

describe("aggregateUploadedSpend", () => {
  it("aggregates by category with spend = price × qty, ASP, and shares", () => {
    const d = aggregateUploadedSpend([
      { category: "Spine", unitPrice: 100, quantity: 10, vendor: "Acme" }, // 1000
      { category: "Spine", unitPrice: 200, quantity: 5, vendor: "Acme" }, // 1000
      { category: "Trauma", unitPrice: 50, quantity: 20, vendor: "Beta" }, // 1000
    ])
    expect(d.currentVendorSpend).toBe(3000)
    expect(d.hasData).toBe(true)
    // Sorted desc by spend: Spine (2000, 15 units) then Trauma (1000).
    const [spine, trauma] = d.categories
    expect(spine!.spendShare).toBeCloseTo(2000 / 3000, 5)
    expect(spine!.asp).toBeCloseTo(2000 / 15, 5)
    expect(trauma!.spendShare).toBeCloseTo(1 / 3, 5)
  })

  it("prefers explicit spend over price × qty", () => {
    const d = aggregateUploadedSpend([
      { category: "Spine", unitPrice: 100, quantity: 10, spend: 5000 },
    ])
    expect(d.currentVendorSpend).toBe(5000)
  })

  it("net revenue is implied from spend (spend ÷ 0.30)", () => {
    const d = aggregateUploadedSpend([{ category: "X", spend: 3_000_000 }])
    expect(d.revenueIsImplied).toBe(true)
    expect(d.netRevenue).toBeCloseTo(10_000_000, 0)
  })

  it("vendor shares + top-vendor concentration", () => {
    const d = aggregateUploadedSpend([
      { vendor: "Acme", spend: 7000, category: "A" },
      { vendor: "Beta", spend: 3000, category: "A" },
    ])
    expect(d.vendors[0]!.vendor).toBe("Acme")
    expect(d.topVendorConcentrationPct).toBeCloseTo(0.7, 5)
  })

  it("canonicalizes category names (case/spacing-insensitive merge)", () => {
    const d = aggregateUploadedSpend([
      { category: "Joint Replacement", spend: 100 },
      { category: "joint  replacement", spend: 100 },
    ])
    expect(d.categories).toHaveLength(1)
    expect(d.categories[0]!.spendShare).toBeCloseTo(1, 5)
  })

  it("empty / zero-spend input → hasData false", () => {
    expect(aggregateUploadedSpend([]).hasData).toBe(false)
    expect(aggregateUploadedSpend([{ category: "X", unitPrice: 0 }]).hasData).toBe(false)
  })

  it("rows without a category still count toward spend (just not categorized)", () => {
    const d = aggregateUploadedSpend([{ vendor: "Acme", spend: 500 }])
    expect(d.currentVendorSpend).toBe(500)
    expect(d.categories).toHaveLength(0)
    expect(d.vendors).toHaveLength(1)
  })
})
