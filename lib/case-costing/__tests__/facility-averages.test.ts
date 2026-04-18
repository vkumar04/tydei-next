import { describe, it, expect } from "vitest"
import { computeFacilityAverages } from "../facility-averages"

describe("computeFacilityAverages", () => {
  it("empty cases → all zeros, timeInOr null", () => {
    const r = computeFacilityAverages({ cases: [] })
    expect(r.avgCaseCost).toBe(0)
    expect(r.avgReimbursementPerCase).toBe(0)
    expect(r.avgMarginPct).toBe(0)
    expect(r.avgTimeInOrMinutes).toBeNull()
  })

  it("single case → averages equal the single case values", () => {
    const r = computeFacilityAverages({
      cases: [
        { totalSpend: 8_000, totalReimbursement: 10_000, timeInOrMinutes: 90 },
      ],
    })
    expect(r.avgCaseCost).toBe(8_000)
    expect(r.avgReimbursementPerCase).toBe(10_000)
    // (10k - 8k) / 10k * 100 = 20
    expect(r.avgMarginPct).toBe(20)
    expect(r.avgTimeInOrMinutes).toBe(90)
  })

  it("averages across multiple cases", () => {
    const r = computeFacilityAverages({
      cases: [
        { totalSpend: 10_000, totalReimbursement: 20_000, timeInOrMinutes: 60 },
        { totalSpend: 20_000, totalReimbursement: 30_000, timeInOrMinutes: 120 },
        { totalSpend: 30_000, totalReimbursement: 50_000, timeInOrMinutes: 180 },
      ],
    })
    // totals: spend=60k, reimb=100k → avg spend=20k, avg reimb=33333.33…
    expect(r.avgCaseCost).toBe(20_000)
    expect(r.avgReimbursementPerCase).toBeCloseTo(33_333.333, 2)
    // Margin (sum method): (100k - 60k) / 100k * 100 = 40
    expect(r.avgMarginPct).toBe(40)
    expect(r.avgTimeInOrMinutes).toBe(120)
  })

  it("avgMarginPct uses sum-method (not mean of per-case pct)", () => {
    // case A: spend 90, reimb 100 → 10% margin
    // case B: spend 20, reimb 100 → 80% margin
    // per-case mean would be 45%. Sum-method: (200-110)/200 = 45%. Equal here,
    // so construct asymmetric amounts: one tiny case with 90% margin, one huge
    // with 10% margin. Per-case mean = 50%, sum method should weight by size.
    const r = computeFacilityAverages({
      cases: [
        { totalSpend: 10, totalReimbursement: 100 }, // 90% margin, reimb=100
        { totalSpend: 90_000, totalReimbursement: 100_000 }, // 10% margin, reimb=100k
      ],
    })
    // Sum: spend=90_010, reimb=100_100 → margin = 10_090/100_100 ≈ 10.08%
    expect(r.avgMarginPct).toBeCloseTo(10.08, 1)
    expect(r.avgMarginPct).toBeLessThan(50)
  })

  it("mixed null/non-null timeInOr → averaged from non-null only", () => {
    const r = computeFacilityAverages({
      cases: [
        { totalSpend: 1, totalReimbursement: 2, timeInOrMinutes: 60 },
        { totalSpend: 1, totalReimbursement: 2, timeInOrMinutes: null },
        { totalSpend: 1, totalReimbursement: 2, timeInOrMinutes: 120 },
        { totalSpend: 1, totalReimbursement: 2 /* undefined */ },
      ],
    })
    // Only 60 + 120 counted → mean = 90
    expect(r.avgTimeInOrMinutes).toBe(90)
  })

  it("all null timeInOr → avgTimeInOrMinutes is null", () => {
    const r = computeFacilityAverages({
      cases: [
        { totalSpend: 1, totalReimbursement: 2, timeInOrMinutes: null },
        { totalSpend: 1, totalReimbursement: 2 /* undefined */ },
      ],
    })
    expect(r.avgTimeInOrMinutes).toBeNull()
  })

  it("avgMarginPct is 0 when total reimbursement is 0 (no NaN)", () => {
    const r = computeFacilityAverages({
      cases: [
        { totalSpend: 1_000, totalReimbursement: 0 },
        { totalSpend: 2_000, totalReimbursement: 0 },
      ],
    })
    expect(r.avgMarginPct).toBe(0)
    expect(Number.isNaN(r.avgMarginPct)).toBe(false)
  })
})
