import { describe, it, expect } from "vitest"
import { computeProjectedRebate } from "@/lib/contracts/projected-rebate"
import type { TierLike } from "@/lib/rebates/calculate"

const ladder: TierLike[] = [
  { tierNumber: 1, spendMin: 100_000, spendMax: 300_000, rebateValue: 3 },
  { tierNumber: 2, spendMin: 300_000, spendMax: null, rebateValue: 5 },
]

describe("computeProjectedRebate (Charles N14)", () => {
  it("projects full-year rebate using trailing-12-month spend", () => {
    // Rolling-12 spend $500K → tier 2 @ 5% → $25K projected.
    const r = computeProjectedRebate({
      rolling12Spend: 500_000,
      rebateEarnedYTD: 8_000,
      tiers: ladder,
    })
    expect(r.projectedFullYear).toBe(25_000)
    expect(r.projectedRemaining).toBe(17_000)
    expect(r.projectedTotalAtYearEnd).toBe(25_000)
  })

  it("projectedRemaining clamps at zero when ytd already exceeds full-year proj", () => {
    // Contract had a big lump sum last year that already landed in the ledger;
    // rolling-12 has dropped so this year's projection is smaller. Remaining
    // must be 0, not negative.
    const r = computeProjectedRebate({
      rolling12Spend: 120_000,
      rebateEarnedYTD: 10_000, // $120K × 3% = $3,600 projection
      tiers: ladder,
    })
    expect(r.projectedFullYear).toBe(3_600)
    expect(r.projectedRemaining).toBe(0)
    expect(r.projectedTotalAtYearEnd).toBe(10_000)
  })

  it("below-baseline rolling-12 → $0 projection", () => {
    const r = computeProjectedRebate({
      rolling12Spend: 50_000,
      rebateEarnedYTD: 0,
      tiers: ladder,
    })
    expect(r.projectedFullYear).toBe(0)
    expect(r.projectedRemaining).toBe(0)
    expect(r.projectedTotalAtYearEnd).toBe(0)
  })

  it("confidence band attaches when a spend history is provided", () => {
    // Noisy history → low r², forecaster should return a non-trivial band.
    const history = [
      { date: new Date(Date.UTC(2025, 0, 1)), value: 30_000 },
      { date: new Date(Date.UTC(2025, 1, 1)), value: 60_000 },
      { date: new Date(Date.UTC(2025, 2, 1)), value: 20_000 },
      { date: new Date(Date.UTC(2025, 3, 1)), value: 80_000 },
      { date: new Date(Date.UTC(2025, 4, 1)), value: 40_000 },
      { date: new Date(Date.UTC(2025, 5, 1)), value: 70_000 },
    ]
    const r = computeProjectedRebate({
      rolling12Spend: 500_000,
      rebateEarnedYTD: 5_000,
      tiers: ladder,
      spendHistory: history,
    })
    expect(r.confidence).not.toBeNull()
    if (r.confidence) {
      expect(r.confidence.low).toBeLessThanOrEqual(r.confidence.high)
      expect(r.confidence.r2).toBeGreaterThanOrEqual(0)
      expect(r.confidence.r2).toBeLessThanOrEqual(1)
    }
  })

  it("no spend history → confidence is null", () => {
    const r = computeProjectedRebate({
      rolling12Spend: 500_000,
      rebateEarnedYTD: 5_000,
      tiers: ladder,
    })
    expect(r.confidence).toBeNull()
  })
})
