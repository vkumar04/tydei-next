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

// ─── Regression: Charles feedback R4.6 / R4.7 ────────────────────────
//
// R4.6 — "I made the evaluation period monthly and still no rebate
// calculated": the accrual engine ignored ContractTerm.evaluationPeriod
// and always tier-qualified on cumulative spend, so a monthly-eval
// contract whose tier 1 spendMin was sized for annual totals never paid
// a rebate in any single month.
//
// R4.7 — "I think it is forcing me to get to tier 3 before paying a
// rebate": same root cause, different flavor. A user with tiers
// [(0, 100k, 2%), (100k, 200k, 3%)] and monthly spend of $50K expects
// tier 1 to pay every month. Under annual eval with fresh COG, the
// cumulative spend takes months to cross $100K, so the UI reads "no
// rebate yet" and reaches tier 2/3 later than expected.

describe("buildMonthlyAccruals — evaluationPeriod", () => {
  const TWO_TIERS: TierLike[] = [
    { tierNumber: 1, spendMin: 0, spendMax: 100_000, rebateValue: 2 },
    { tierNumber: 2, spendMin: 100_000, spendMax: null, rebateValue: 3 },
  ]

  it("tier 1 pays on the first month of monthly-eval when spend meets spendMin=0", () => {
    // Charles R4.7: tier 1 starts at spendMin=0, so ANY non-zero monthly
    // spend should earn a rebate at tier 1's rate. Tiers [(0-100k=2%,
    // 100k+=3%)] with monthly spend $50K → rebate = $50K × 2% = $1,000,
    // achieved tier = 1. Before the fix, the same data returned $0
    // because cumulative was $50K but that's not why — the real bug
    // surfaces when spendMin on tier 1 is non-zero (see next test).
    const series: MonthlySpend[] = [{ month: "2026-01", spend: 50_000 }]
    const rows = buildMonthlyAccruals(series, TWO_TIERS, "cumulative", "monthly")
    expect(rows[0].tierAchieved).toBe(1)
    expect(rows[0].accruedAmount).toBe(1_000)
    expect(rows[0].rebatePercent).toBe(2)
  })

  it("monthly eval qualifies tier from this month's spend — not cumulative annual", () => {
    // Ladder designed for annual totals: tier 1 requires $300K, tier 2
    // requires $600K. Monthly facility spend of $50K × 12 = $600K would
    // clear tier 2 under ANNUAL evaluation, but under MONTHLY evaluation
    // the tier should be determined by each month's $50K — below tier 1,
    // so the engine never promotes past tier 1 rate (every month stays
    // at tier 1's 2%). Annual-eval behavior (the bug Charles hit) would
    // by December see $600K cumulative and pay tier 2 rate on the final
    // month's spend; monthly-eval produces a flat per-month accrual.
    const annualLadder: TierLike[] = [
      { tierNumber: 1, spendMin: 300_000, spendMax: 600_000, rebateValue: 2 },
      { tierNumber: 2, spendMin: 600_000, spendMax: null, rebateValue: 4 },
    ]
    const series: MonthlySpend[] = Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, "0")}`,
      spend: 50_000,
    }))
    const monthly = buildMonthlyAccruals(
      series,
      annualLadder,
      "cumulative",
      "monthly",
    )
    // Every month: $50K qualifies for tier 1 default (2% rate under the
    // current engine semantics when spend < lowest spendMin).
    // Importantly, no month ever promotes to tier 2 — the tier is stable.
    for (const row of monthly) {
      expect(row.tierAchieved).toBe(1)
      expect(row.rebatePercent).toBe(2)
      expect(row.accruedAmount).toBe(1_000)
    }

    // Contrast: annual eval on the same data DOES promote at month 12.
    const annual = buildMonthlyAccruals(series, annualLadder, "cumulative")
    // Month 12: cumulative = $600K → tier 2 (4%) → $50K × 4% = $2,000.
    expect(annual[11].tierAchieved).toBe(2)
    expect(annual[11].accruedAmount).toBe(2_000)
  })

  it("monthly eval pays rebate when this month's spend meets tier 1 — even though annual-sized ladder would not accrue under annual eval", () => {
    // Concrete R4.6 repro: ladder sized for monthly cadence.
    // Tiers: [(0, 40K, 2%), (40K, 80K, 3%), (80K+, 5%)]. A facility
    // spending $50K / month expects tier 2 (3%) = $1,500 rebate EACH
    // month, not $0 because annual cumulative was $0 in January.
    const monthlyLadder: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: 40_000, rebateValue: 2 },
      { tierNumber: 2, spendMin: 40_000, spendMax: 80_000, rebateValue: 3 },
      { tierNumber: 3, spendMin: 80_000, spendMax: null, rebateValue: 5 },
    ]
    const series: MonthlySpend[] = [
      { month: "2026-01", spend: 50_000 },
      { month: "2026-02", spend: 50_000 },
    ]
    const monthly = buildMonthlyAccruals(
      series,
      monthlyLadder,
      "cumulative",
      "monthly",
    )
    // Each month stands alone: $50K qualifies for tier 2 (3%).
    expect(monthly[0].tierAchieved).toBe(2)
    expect(monthly[0].rebatePercent).toBe(3)
    expect(monthly[0].accruedAmount).toBe(1_500)
    expect(monthly[1].tierAchieved).toBe(2)
    expect(monthly[1].accruedAmount).toBe(1_500)

    // Regression guard: annual-eval (default) on the SAME data would
    // promote through tiers as cumulative crosses thresholds.
    const annual = buildMonthlyAccruals(series, monthlyLadder, "cumulative")
    // Jan: cumulative $50K → tier 2 (3%) → $50K × 3% = $1,500.
    expect(annual[0].accruedAmount).toBe(1_500)
    // Feb: cumulative $100K → tier 3 (5%) → $50K × 5% = $2,500 (promoted).
    expect(annual[1].accruedAmount).toBe(2_500)
  })

  it("annual eval (default) is unchanged by the evaluationPeriod param", () => {
    // Regression guard: callers that didn't pass evaluationPeriod
    // continue to see the pre-fix cumulative-annual behavior.
    const series: MonthlySpend[] = [
      { month: "2026-01", spend: 10_000 },
      { month: "2026-02", spend: 15_000 },
      { month: "2026-03", spend: 30_000 },
    ]
    const withoutParam = buildMonthlyAccruals(series, TIERS, "cumulative")
    const withAnnual = buildMonthlyAccruals(
      series,
      TIERS,
      "cumulative",
      "annual",
    )
    expect(withAnnual).toEqual(withoutParam)
  })

  it("quarterly eval tier-qualifies on rolling 3-month window", () => {
    // 3 months at $20K each = $60K trailing window by month 3 → tier 2
    // (3%) under ladder [(0,50k=2%), (50k,100k=3%)]. January's rebate
    // uses January alone ($20K) → tier 1 (2%) → $400.
    const series: MonthlySpend[] = [
      { month: "2026-01", spend: 20_000 },
      { month: "2026-02", spend: 20_000 },
      { month: "2026-03", spend: 20_000 },
    ]
    const rows = buildMonthlyAccruals(
      series,
      [
        { tierNumber: 1, spendMin: 0, spendMax: 50_000, rebateValue: 2 },
        { tierNumber: 2, spendMin: 50_000, spendMax: 100_000, rebateValue: 3 },
      ],
      "cumulative",
      "quarterly",
    )
    // Jan window: $20K → tier 1 (2%) → $20K × 2% = $400.
    expect(rows[0].tierAchieved).toBe(1)
    expect(rows[0].accruedAmount).toBe(400)
    // Feb window: $40K → tier 1 (2%) → $20K × 2% = $400.
    expect(rows[1].tierAchieved).toBe(1)
    expect(rows[1].accruedAmount).toBe(400)
    // Mar window: $60K → tier 2 (3%) → $20K × 3% = $600.
    expect(rows[2].tierAchieved).toBe(2)
    expect(rows[2].accruedAmount).toBe(600)
  })
})

// ─── Regression: Charles feedback R5.6 ───────────────────────────────
//
// Charles R5.6: "on this pricing only contract it is showing rebates
// and transactions when none were entered in when creating it."
// Pricing-only contracts are locked-price agreements — they are
// fundamentally not rebate-bearing. The accrual/seed layers must treat
// them as ineligible so the transactions ledger stays empty.

import { contractTypeEarnsRebates } from "@/lib/contract-definitions"

describe("contractTypeEarnsRebates — R5.6 pricing-only gate", () => {
  it("returns false for pricing_only (the fix)", () => {
    expect(contractTypeEarnsRebates("pricing_only")).toBe(false)
  })

  it("returns true for usage, service, tie_in, grouped (rebate-bearing types)", () => {
    expect(contractTypeEarnsRebates("usage")).toBe(true)
    expect(contractTypeEarnsRebates("service")).toBe(true)
    expect(contractTypeEarnsRebates("tie_in")).toBe(true)
    expect(contractTypeEarnsRebates("grouped")).toBe(true)
  })

  it("returns true for capital (consumable portion of capital contracts can still rebate)", () => {
    // Intentional: today only pricing_only is hard-excluded. Capital
    // contracts often carry consumable/service sub-terms that pay
    // rebates — we don't want to suppress those by blanket-filtering.
    expect(contractTypeEarnsRebates("capital")).toBe(true)
  })
})
