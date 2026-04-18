import { describe, it, expect } from "vitest"
import {
  calculateRequiredDiscount,
  calculateSpendNeededForIncrementalRebate,
  projectRebateAtTier,
} from "../volume-discount-calc"

describe("calculateRequiredDiscount", () => {
  it("computes required discount to hit savings target", () => {
    const r = calculateRequiredDiscount({
      projectedSpend: 100_000,
      currentDiscountPercent: 0.05,
      targetSavings: 10_000,
    })
    expect(r.requiredDiscountPercent).toBe(0.1) // 10K / 100K
    expect(r.incrementalDiscountPercent).toBeCloseTo(0.05, 10) // 0.10 - 0.05
    expect(r.achievable).toBe(true)
  })

  it("zero incremental when current already meets target", () => {
    const r = calculateRequiredDiscount({
      projectedSpend: 100_000,
      currentDiscountPercent: 0.15,
      targetSavings: 10_000,
    })
    expect(r.requiredDiscountPercent).toBe(0.1)
    expect(r.incrementalDiscountPercent).toBe(0) // current 15% already > required 10%
  })

  it("unachievable when required > 100%", () => {
    const r = calculateRequiredDiscount({
      projectedSpend: 10_000,
      currentDiscountPercent: 0,
      targetSavings: 15_000,
    })
    expect(r.requiredDiscountPercent).toBe(1.5)
    expect(r.achievable).toBe(false)
  })

  it("safe with zero projected spend", () => {
    const r = calculateRequiredDiscount({
      projectedSpend: 0,
      currentDiscountPercent: 0.05,
      targetSavings: 5000,
    })
    expect(r.requiredDiscountPercent).toBe(0)
    expect(r.achievable).toBe(false)
  })

  it("safe with negative projected spend (defensive)", () => {
    const r = calculateRequiredDiscount({
      projectedSpend: -1000,
      currentDiscountPercent: 0,
      targetSavings: 100,
    })
    expect(r.achievable).toBe(false)
  })
})

describe("calculateSpendNeededForIncrementalRebate", () => {
  it("returns target / rate (as decimal)", () => {
    // $1000 target at 4% rate → $25,000
    expect(
      calculateSpendNeededForIncrementalRebate({
        nextTierRate: 4,
        incrementalRebateTarget: 1000,
      }),
    ).toBe(25_000)
  })

  it("handles large rebate target", () => {
    expect(
      calculateSpendNeededForIncrementalRebate({
        nextTierRate: 6,
        incrementalRebateTarget: 30_000,
      }),
    ).toBe(500_000)
  })

  it("returns 0 when rate is zero or negative", () => {
    expect(
      calculateSpendNeededForIncrementalRebate({
        nextTierRate: 0,
        incrementalRebateTarget: 1000,
      }),
    ).toBe(0)
    expect(
      calculateSpendNeededForIncrementalRebate({
        nextTierRate: -1,
        incrementalRebateTarget: 1000,
      }),
    ).toBe(0)
  })
})

describe("projectRebateAtTier", () => {
  it("spend × rate / 100", () => {
    expect(projectRebateAtTier({ spend: 100_000, tierRate: 4 })).toBe(4000)
  })

  it("zero spend → zero rebate", () => {
    expect(projectRebateAtTier({ spend: 0, tierRate: 5 })).toBe(0)
  })

  it("zero rate → zero rebate", () => {
    expect(projectRebateAtTier({ spend: 100_000, tierRate: 0 })).toBe(0)
  })

  it("negative inputs → 0 (defensive)", () => {
    expect(projectRebateAtTier({ spend: -100, tierRate: 4 })).toBe(0)
    expect(projectRebateAtTier({ spend: 100, tierRate: -5 })).toBe(0)
  })
})
