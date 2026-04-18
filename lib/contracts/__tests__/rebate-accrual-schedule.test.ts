import { describe, it, expect } from "vitest"
import {
  projectRebateAccrualSchedule,
  type AccrualTier,
} from "../rebate-accrual-schedule"

const twoTier: AccrualTier[] = [
  { spendMin: 0, spendMax: 50_000, rebateValue: 2 },
  { spendMin: 50_000, spendMax: null, rebateValue: 4 },
]

describe("projectRebateAccrualSchedule", () => {
  it("returns an empty array when periodProjections is empty", () => {
    const out = projectRebateAccrualSchedule({
      tiers: twoTier,
      periodProjections: [],
      method: "cumulative",
      boundaryRule: "inclusive",
    })
    expect(out).toEqual([])
  })

  it("projects a single period under cumulative method", () => {
    const out = projectRebateAccrualSchedule({
      tiers: twoTier,
      periodProjections: [{ periodNumber: 1, projectedSpend: 30_000 }],
      method: "cumulative",
      boundaryRule: "inclusive",
    })
    expect(out).toHaveLength(1)
    const row = out[0]!
    expect(row.cumulativeSpend).toBe(30_000)
    expect(row.achievedTier).toBe(1)
    expect(row.rebateAccrualPercent).toBe(2)
    // cumulative: 30,000 × 2% = $600
    expect(row.projectedRebate).toBeCloseTo(600, 6)
  })

  it("handles a multi-period cumulative schedule where tier changes", () => {
    // Periods: 30k, 30k, 40k → cumulative 30k, 60k, 100k
    // Cumulative method:
    //  period 1: 30k × 2% = 600
    //  period 2: cumulativeRebate(60k) = 60k × 4% = 2,400; delta = 2,400 − 600 = 1,800
    //  period 3: cumulativeRebate(100k) = 100k × 4% = 4,000; delta = 4,000 − 2,400 = 1,600
    const out = projectRebateAccrualSchedule({
      tiers: twoTier,
      periodProjections: [
        { periodNumber: 1, projectedSpend: 30_000 },
        { periodNumber: 2, projectedSpend: 30_000 },
        { periodNumber: 3, projectedSpend: 40_000 },
      ],
      method: "cumulative",
      boundaryRule: "exclusive",
    })
    expect(out).toHaveLength(3)
    expect(out[0]!.projectedRebate).toBeCloseTo(600, 6)
    expect(out[0]!.achievedTier).toBe(1)
    expect(out[1]!.projectedRebate).toBeCloseTo(1800, 6)
    expect(out[1]!.achievedTier).toBe(2)
    expect(out[2]!.projectedRebate).toBeCloseTo(1600, 6)
    expect(out[2]!.achievedTier).toBe(2)
    // Sum across periods = final cumulative rebate at 100k
    const total = out.reduce((s, r) => s + r.projectedRebate, 0)
    expect(total).toBeCloseTo(4000, 6)
  })

  it("computes marginal method bracket-by-bracket across periods", () => {
    // Periods: 30k, 30k, 40k → cumulative 30k, 60k, 100k
    // Marginal method:
    //  at 30k: 30k × 2% = 600
    //  at 60k: 50k × 2% + 10k × 4% = 1000 + 400 = 1400; period delta = 800
    //  at 100k: 50k × 2% + 50k × 4% = 1000 + 2000 = 3000; period delta = 1600
    const out = projectRebateAccrualSchedule({
      tiers: twoTier,
      periodProjections: [
        { periodNumber: 1, projectedSpend: 30_000 },
        { periodNumber: 2, projectedSpend: 30_000 },
        { periodNumber: 3, projectedSpend: 40_000 },
      ],
      method: "marginal",
      boundaryRule: "exclusive",
    })
    expect(out[0]!.projectedRebate).toBeCloseTo(600, 6)
    expect(out[1]!.projectedRebate).toBeCloseTo(800, 6)
    expect(out[2]!.projectedRebate).toBeCloseTo(1600, 6)
    const total = out.reduce((s, r) => s + r.projectedRebate, 0)
    expect(total).toBeCloseTo(3000, 6)
  })

  it("reflects tier change within the cumulative trajectory", () => {
    // Two periods that straddle the 50k boundary under cumulative method.
    // 40k then 20k → cumulative 40k (tier 1), 60k (tier 2).
    const out = projectRebateAccrualSchedule({
      tiers: twoTier,
      periodProjections: [
        { periodNumber: 1, projectedSpend: 40_000 },
        { periodNumber: 2, projectedSpend: 20_000 },
      ],
      method: "cumulative",
      boundaryRule: "inclusive",
    })
    expect(out[0]!.achievedTier).toBe(1)
    expect(out[0]!.rebateAccrualPercent).toBe(2)
    expect(out[1]!.achievedTier).toBe(2)
    expect(out[1]!.rebateAccrualPercent).toBe(4)
  })

  it("applies exclusive vs inclusive boundary rule at an exact threshold", () => {
    // Spend of exactly 50,000 — right on the tier-2 lower bound.
    // EXCLUSIVE: 50k is IN tier 2 (rate 4%)
    // INCLUSIVE: 50k is IN tier 1 (rate 2%) — tier 2 starts ABOVE 50k
    const exclusive = projectRebateAccrualSchedule({
      tiers: twoTier,
      periodProjections: [{ periodNumber: 1, projectedSpend: 50_000 }],
      method: "cumulative",
      boundaryRule: "exclusive",
    })
    const inclusive = projectRebateAccrualSchedule({
      tiers: twoTier,
      periodProjections: [{ periodNumber: 1, projectedSpend: 50_000 }],
      method: "cumulative",
      boundaryRule: "inclusive",
    })
    expect(exclusive[0]!.achievedTier).toBe(2)
    expect(exclusive[0]!.rebateAccrualPercent).toBe(4)
    expect(inclusive[0]!.achievedTier).toBe(1)
    expect(inclusive[0]!.rebateAccrualPercent).toBe(2)
  })

  it("zero tiers produce zero rebate + achievedTier 0", () => {
    const out = projectRebateAccrualSchedule({
      tiers: [],
      periodProjections: [{ periodNumber: 1, projectedSpend: 10_000 }],
      method: "cumulative",
      boundaryRule: "inclusive",
    })
    expect(out[0]!.achievedTier).toBe(0)
    expect(out[0]!.rebateAccrualPercent).toBe(0)
    expect(out[0]!.projectedRebate).toBe(0)
  })
})
