import { describe, it, expect } from "vitest"
import {
  calculateMonthlyAccrual,
  calculateQuarterlyTrueUp,
  calculateAnnualSettlement,
  buildMonthlyAccruals,
  type MonthlySpend,
} from "@/lib/contracts/accrual"
import type { TierLike } from "@/lib/contracts/rebate-method"

const TIERS: TierLike[] = [
  { tierNumber: 1, spendMin: 0, spendMax: 50_000, rebateValue: 2 },
  { tierNumber: 2, spendMin: 50_000, spendMax: 100_000, rebateValue: 3 },
  { tierNumber: 3, spendMin: 100_000, spendMax: null, rebateValue: 4 },
]

describe("calculateMonthlyAccrual", () => {
  it("accrues at the currently-achieved tier rate (cumulative)", () => {
    // Cumulative tier at $30K cumulative spend = tier 1 (2%)
    // Monthly spend of $10K → $200 accrual
    const result = calculateMonthlyAccrual(10_000, 30_000, TIERS, "cumulative")
    expect(result.accruedAmount).toBe(200)
    expect(result.tierAchieved).toBe(1)
  })

  it("accrues at the promoted tier rate once cumulative crosses threshold", () => {
    // Cumulative spend $60K → tier 2 (3%)
    // Monthly spend of $15K → $450 accrual
    const result = calculateMonthlyAccrual(15_000, 60_000, TIERS, "cumulative")
    expect(result.accruedAmount).toBe(450)
    expect(result.tierAchieved).toBe(2)
  })

  it("marginal method applies rates across brackets for the monthly delta", () => {
    // Previous cumulative $40K, this month spent $20K → bracket $40K-$50K @ 2% and $50K-$60K @ 3%
    // $10K × 2% + $10K × 3% = $200 + $300 = $500
    const result = calculateMonthlyAccrual(20_000, 60_000, TIERS, "marginal")
    expect(result.accruedAmount).toBe(500)
  })

  it("zero spend returns zero accrual", () => {
    const result = calculateMonthlyAccrual(0, 30_000, TIERS, "cumulative")
    expect(result.accruedAmount).toBe(0)
  })
})

describe("calculateQuarterlyTrueUp", () => {
  it("returns positive adjustment when tier bump means past months under-accrued", () => {
    // Quarter spend: Jan $15K, Feb $20K, Mar $20K = $55K → tier 2 (3%) cumulative
    // Actual quarterly rebate: $55K × 3% = $1,650
    // Previously accrued at tier 1 (2%): $15K×2% + $20K×2% + $20K×2% = $1,100
    // Adjustment = $1,650 − $1,100 = $550
    const previousAccruals = [300, 400, 400]
    const result = calculateQuarterlyTrueUp(55_000, TIERS, previousAccruals, "cumulative")
    expect(result.actualRebate).toBe(1_650)
    expect(result.previousAccruals).toBe(1_100)
    expect(result.adjustment).toBe(550)
    expect(result.newTier).toBe(2)
  })

  it("returns negative adjustment when over-accrued", () => {
    // Actual $30K × 2% = $600. Previously accrued $800. Adjustment = -$200.
    const result = calculateQuarterlyTrueUp(30_000, TIERS, [400, 400], "cumulative")
    expect(result.adjustment).toBe(-200)
  })
})

describe("calculateAnnualSettlement", () => {
  it("settles to the final year rebate and returns the delta vs accruals", () => {
    // Full year: $150K spend, cumulative tier 3 (4%) = $6,000 final rebate.
    // Total accrued over 12 months: assume $4,200 accrued.
    // Settlement owed = $6,000 − $4,200 = $1,800.
    const monthlyAccruals = Array(12).fill(350) // $4,200 total
    const result = calculateAnnualSettlement(150_000, TIERS, monthlyAccruals, "cumulative")
    expect(result.finalRebate).toBe(6_000)
    expect(result.totalAccrued).toBe(4_200)
    expect(result.settlementAmount).toBe(1_800)
    expect(result.achievedTier).toBe(3)
  })

  it("marginal settlement totals bracket earnings", () => {
    // $150K marginal = $50K×2% + $50K×3% + $50K×4% = $4,500
    const result = calculateAnnualSettlement(150_000, TIERS, [0], "marginal")
    expect(result.finalRebate).toBe(4_500)
    expect(result.achievedTier).toBe(3)
  })
})

describe("buildMonthlyAccruals", () => {
  it("produces a running accrual timeline from a monthly-spend series", () => {
    const series: MonthlySpend[] = [
      { month: "2026-01", spend: 10_000 },
      { month: "2026-02", spend: 15_000 },
      { month: "2026-03", spend: 30_000 },
    ]
    const result = buildMonthlyAccruals(series, TIERS, "cumulative")
    // Jan: cumulative $10K → tier 1 (2%) → $200
    // Feb: cumulative $25K → tier 1 (2%) → $300
    // Mar: cumulative $55K → tier 2 (3%) → $900 (promoted mid-month; we use end-of-month tier)
    expect(result[0].accruedAmount).toBe(200)
    expect(result[1].accruedAmount).toBe(300)
    expect(result[2].accruedAmount).toBe(900)
    expect(result[2].tierAchieved).toBe(2)
    // Running cumulative stored on each row for UI reference
    expect(result[2].cumulativeSpend).toBe(55_000)
  })
})
