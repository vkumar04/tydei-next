/**
 * Charles W1.W-B1 regression: annual-evaluation-period contracts were
 * accruing MONTHLY with $0 spend and non-zero earned because the
 * recompute pipeline walked per-month rows and emitted a sliver every
 * month. Rule: a term with `evaluationPeriod = 'annual'` must emit ONE
 * Rebate row at period-end (12 months after effective start, then
 * yearly) carrying the aggregate spend over that 12 months. Nothing
 * before period-end. Same shape for `quarterly` (3mo) and `semi_annual`
 * (6mo). Monthly-eval terms keep the prior per-month behavior.
 *
 * The test exercises the pure helper `buildEvaluationPeriodAccruals`
 * directly so the invariant lives in the math layer — the recompute
 * action and the bulk regen script both delegate to this helper.
 */
import { describe, it, expect } from "vitest"
import {
  buildEvaluationPeriodAccruals,
  type MonthlySpend,
} from "@/lib/contracts/accrual"
import type { TierLike } from "@/lib/rebates/calculate"

const TIERS_3PCT: TierLike[] = [
  // rebateValue is fed in the engine's unit (integer percent) — callers
  // at the Prisma boundary scale fractions (0.03) via
  // `scaleRebateValueForEngine`. Using `3` here mirrors post-scale shape.
  { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 3 },
]

function twelveMonthsFrom(year: number, tenKPerMonth: number): MonthlySpend[] {
  const months: MonthlySpend[] = []
  for (let m = 1; m <= 12; m++) {
    months.push({
      month: `${year}-${String(m).padStart(2, "0")}`,
      spend: tenKPerMonth,
    })
  }
  return months
}

describe("buildEvaluationPeriodAccruals — lifetime (bugs.rtfd 2026-06-13)", () => {
  it("emits ONE window over the whole contract; tier qualifies on cumulative spend", () => {
    // 3 calendar years, ~$340K/yr = $1.02M total, tier 1 = $825K @ 2%.
    // Per-year ($340K) never reaches $825K, but lifetime accumulates → 2%.
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 825_000, spendMax: null, rebateValue: 2 },
    ]
    const series: MonthlySpend[] = []
    for (const y of [2024, 2025, 2026])
      for (let m = 1; m <= 12; m++)
        series.push({ month: `${y}-${String(m).padStart(2, "0")}`, spend: 28_333.34 })
    const buckets = buildEvaluationPeriodAccruals(
      series,
      tiers,
      "cumulative",
      "lifetime",
      new Date(Date.UTC(2024, 0, 1)),
      { boundedUntil: new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999)) },
    )
    expect(buckets.length).toBe(1)
    expect(buckets[0].label).toBe("Contract total")
    const total = 28_333.34 * 36
    expect(buckets[0].totalSpend).toBeCloseTo(total, 1)
    expect(buckets[0].tierAchieved).toBe(1)
    // 2% × cumulative $1.02M
    expect(buckets[0].rebateEarned).toBeCloseTo(total * 0.02, 1)
  })

  it("an annual term on the same series earns $0 (no single year clears $825K)", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 825_000, spendMax: null, rebateValue: 2 },
    ]
    const series: MonthlySpend[] = []
    for (const y of [2024, 2025, 2026])
      for (let m = 1; m <= 12; m++)
        series.push({ month: `${y}-${String(m).padStart(2, "0")}`, spend: 28_333.34 })
    const buckets = buildEvaluationPeriodAccruals(
      series, tiers, "cumulative", "annual",
      new Date(Date.UTC(2024, 0, 1)),
      { boundedUntil: new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999)) },
    )
    expect(buckets.every((b) => b.rebateEarned === 0)).toBe(true)
  })
})

describe("buildEvaluationPeriodAccruals — annual (W1.W-B1)", () => {
  it("emits ONE row at period-end for a 12-month annual term", () => {
    const series = twelveMonthsFrom(2025, 10_000)
    const buckets = buildEvaluationPeriodAccruals(
      series,
      TIERS_3PCT,
      "cumulative",
      "annual",
      new Date(Date.UTC(2025, 0, 1)),
      { boundedUntil: new Date(Date.UTC(2026, 3, 19)) }, // today = 2026-04-19
    )

    expect(buckets.length).toBe(1)
    const only = buckets[0]
    expect(only.totalSpend).toBe(120_000)
    expect(only.rebateEarned).toBe(3_600)
    expect(only.tierAchieved).toBe(1)
    // payPeriodEnd = effectiveStart + 12 months - 1 day = 2025-12-31.
    expect(only.periodStart.toISOString()).toBe("2025-01-01T00:00:00.000Z")
    expect(only.periodEnd.getUTCFullYear()).toBe(2025)
    expect(only.periodEnd.getUTCMonth()).toBe(11)
    expect(only.periodEnd.getUTCDate()).toBe(31)
  })

  it("emits ZERO rows before the annual period completes", () => {
    // Series: 6 months of spend in 2025. Annual term effective 2025-01-01
    // can't close its window until 2025-12-31; on 2025-07-19 there is no
    // complete evaluation period yet.
    const series: MonthlySpend[] = Array.from({ length: 6 }, (_, i) => ({
      month: `2025-${String(i + 1).padStart(2, "0")}`,
      spend: 10_000,
    }))
    const buckets = buildEvaluationPeriodAccruals(
      series,
      TIERS_3PCT,
      "cumulative",
      "annual",
      new Date(Date.UTC(2025, 0, 1)),
      { boundedUntil: new Date(Date.UTC(2025, 6, 19)) }, // mid-2025
    )
    expect(buckets.length).toBe(0)
  })

  it("stacks multiple annual periods when the series spans years", () => {
    const series = [
      ...twelveMonthsFrom(2024, 10_000),
      ...twelveMonthsFrom(2025, 10_000),
    ]
    const buckets = buildEvaluationPeriodAccruals(
      series,
      TIERS_3PCT,
      "cumulative",
      "annual",
      new Date(Date.UTC(2024, 0, 1)),
      { boundedUntil: new Date(Date.UTC(2026, 3, 19)) },
    )
    expect(buckets.length).toBe(2)
    expect(buckets[0].periodStart.getUTCFullYear()).toBe(2024)
    expect(buckets[0].rebateEarned).toBe(3_600)
    expect(buckets[1].periodStart.getUTCFullYear()).toBe(2025)
    expect(buckets[1].rebateEarned).toBe(3_600)
  })

  it("drops incomplete trailing windows (period-end > boundedUntil)", () => {
    // Three complete 2024 months + three partial 2025 months. Anchor
    // 2024-01-01, annual eval → only 2024 emits; the 2025 window runs
    // 2025-01-01 → 2025-12-31 but boundedUntil is 2025-06-19 so it stays
    // unemitted until year-end.
    const series: MonthlySpend[] = [
      ...twelveMonthsFrom(2024, 10_000),
      { month: "2025-01", spend: 10_000 },
      { month: "2025-02", spend: 10_000 },
      { month: "2025-03", spend: 10_000 },
    ]
    const buckets = buildEvaluationPeriodAccruals(
      series,
      TIERS_3PCT,
      "cumulative",
      "annual",
      new Date(Date.UTC(2024, 0, 1)),
      { boundedUntil: new Date(Date.UTC(2025, 5, 19)) },
    )
    expect(buckets.length).toBe(1)
    expect(buckets[0].periodStart.getUTCFullYear()).toBe(2024)
  })
})

describe("buildEvaluationPeriodAccruals — semi_annual / quarterly", () => {
  it("semi-annual: TWO rows per year each worth half the annual spend", () => {
    const series = twelveMonthsFrom(2025, 10_000)
    const buckets = buildEvaluationPeriodAccruals(
      series,
      TIERS_3PCT,
      "cumulative",
      "semi_annual",
      new Date(Date.UTC(2025, 0, 1)),
      { boundedUntil: new Date(Date.UTC(2026, 3, 19)) },
    )
    expect(buckets.length).toBe(2)
    expect(buckets[0].totalSpend).toBe(60_000)
    expect(buckets[0].rebateEarned).toBe(1_800)
    // H1 ends 2025-06-30; H2 ends 2025-12-31.
    expect(buckets[0].periodEnd.getUTCMonth()).toBe(5)
    expect(buckets[0].periodEnd.getUTCDate()).toBe(30)
    expect(buckets[1].periodEnd.getUTCMonth()).toBe(11)
    expect(buckets[1].periodEnd.getUTCDate()).toBe(31)
  })

  it("quarterly: FOUR rows per year each worth one quarter of the spend", () => {
    const series = twelveMonthsFrom(2025, 10_000)
    const buckets = buildEvaluationPeriodAccruals(
      series,
      TIERS_3PCT,
      "cumulative",
      "quarterly",
      new Date(Date.UTC(2025, 0, 1)),
      // Bound at 2025-12-31 so only 2025's four quarters emit — Q1 2026
      // would otherwise emit with zero spend since boundedUntil passed
      // its period-end (the helper doesn't suppress empties; the caller
      // filters zero-earned rows before persisting).
      { boundedUntil: new Date(Date.UTC(2025, 11, 31, 23, 59, 59, 999)) },
    )
    expect(buckets.length).toBe(4)
    for (const b of buckets) {
      expect(b.totalSpend).toBe(30_000)
      expect(b.rebateEarned).toBe(900)
    }
    // Q1 ends 2025-03-31, Q4 ends 2025-12-31.
    expect(buckets[0].periodEnd.getUTCMonth()).toBe(2)
    expect(buckets[0].periodEnd.getUTCDate()).toBe(31)
    expect(buckets[3].periodEnd.getUTCMonth()).toBe(11)
    expect(buckets[3].periodEnd.getUTCDate()).toBe(31)
  })
})

describe("buildEvaluationPeriodAccruals — tier qualification runs on aggregate spend", () => {
  it("annual cumulative: $120K crosses the $100K tier 2 threshold once the year closes", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: 100_000, rebateValue: 3 },
      { tierNumber: 2, spendMin: 100_000, spendMax: null, rebateValue: 5 },
    ]
    const series = twelveMonthsFrom(2025, 10_000)
    const buckets = buildEvaluationPeriodAccruals(
      series,
      tiers,
      "cumulative",
      "annual",
      new Date(Date.UTC(2025, 0, 1)),
      { boundedUntil: new Date(Date.UTC(2026, 3, 19)) },
    )
    expect(buckets.length).toBe(1)
    expect(buckets[0].totalSpend).toBe(120_000)
    // Cumulative: $120K × 5% = $6,000 (entire spend at top-tier rate).
    expect(buckets[0].rebateEarned).toBe(6_000)
    expect(buckets[0].tierAchieved).toBe(2)
  })

  it("annual marginal: $120K splits $100K @ 3% + $20K @ 5% = $4,000", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: 100_000, rebateValue: 3 },
      { tierNumber: 2, spendMin: 100_000, spendMax: null, rebateValue: 5 },
    ]
    const series = twelveMonthsFrom(2025, 10_000)
    const buckets = buildEvaluationPeriodAccruals(
      series,
      tiers,
      "marginal",
      "annual",
      new Date(Date.UTC(2025, 0, 1)),
      { boundedUntil: new Date(Date.UTC(2026, 3, 19)) },
    )
    expect(buckets.length).toBe(1)
    expect(buckets[0].rebateEarned).toBe(4_000)
    expect(buckets[0].tierAchieved).toBe(2)
  })
})

/**
 * Charles 2026-04-25: growth-baseline support.
 *
 * When `baselineType === "growth_based"` (or `termType === "growth_rebate"`)
 * AND `spendBaseline > 0`, only spend ABOVE the pro-rated baseline counts
 * toward tier qualification. The bucket's reported `totalSpend` stays at
 * gross spend (display surface) but the tier engine sees the growth slice.
 */
describe("buildEvaluationPeriodAccruals — growth-baseline (Charles 2026-04-25)", () => {
  it("annual: $120K spend with $100K annual baseline → tiers see $20K", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 5 },
    ]
    const series = twelveMonthsFrom(2025, 10_000) // $120K total
    const buckets = buildEvaluationPeriodAccruals(
      series,
      tiers,
      "cumulative",
      "annual",
      new Date(Date.UTC(2025, 0, 1)),
      {
        boundedUntil: new Date(Date.UTC(2026, 3, 19)),
        spendBaseline: 100_000,
        growthBased: true,
      },
    )
    expect(buckets.length).toBe(1)
    // Display still shows the full $120K spend...
    expect(buckets[0].totalSpend).toBe(120_000)
    // ...but rebate is computed on growth slice only: $20K × 5% = $1,000.
    expect(buckets[0].rebateEarned).toBe(1_000)
    // bugs.rtfd 2026-06-13 ("not taking the 500K growth baseline into
    // account"): the basis the rate applied to + the cut are now surfaced so
    // display/notes can reconcile rate × basis = earned.
    expect(buckets[0].qualifyingSpend).toBe(20_000)
    expect(buckets[0].growthBaselineApplied).toBe(100_000)
    // Reconciles: 5% × qualifyingSpend === rebateEarned.
    expect(buckets[0].qualifyingSpend * 0.05).toBe(buckets[0].rebateEarned)
  })

  it("no baseline: qualifyingSpend === totalSpend, cut is 0", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 5 },
    ]
    const series = twelveMonthsFrom(2025, 10_000) // $120K total
    const buckets = buildEvaluationPeriodAccruals(
      series,
      tiers,
      "cumulative",
      "annual",
      new Date(Date.UTC(2025, 0, 1)),
      { boundedUntil: new Date(Date.UTC(2026, 3, 19)) },
    )
    expect(buckets.length).toBe(1)
    expect(buckets[0].qualifyingSpend).toBe(120_000)
    expect(buckets[0].growthBaselineApplied).toBe(0)
  })

  it("below-baseline: cut is capped at gross spend (never negative basis)", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 5 },
    ]
    const series = twelveMonthsFrom(2025, 5_000) // $60K total, baseline $100K
    const buckets = buildEvaluationPeriodAccruals(
      series,
      tiers,
      "cumulative",
      "annual",
      new Date(Date.UTC(2025, 0, 1)),
      {
        boundedUntil: new Date(Date.UTC(2026, 3, 19)),
        spendBaseline: 100_000,
        growthBased: true,
      },
    )
    expect(buckets[0].qualifyingSpend).toBe(0)
    // Cut never exceeds gross spend, so basis = max(0, spend − cut) stays ≥ 0.
    expect(buckets[0].growthBaselineApplied).toBe(60_000)
    expect(buckets[0].rebateEarned).toBe(0)
  })

  it("quarterly: pro-rates the annual baseline to the period (÷4)", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 5 },
    ]
    // Q1: $40K spend, annual baseline $100K → quarterly baseline $25K →
    // growth slice $15K → 5% × $15K = $750.
    const series: MonthlySpend[] = [
      { month: "2025-01", spend: 15_000 },
      { month: "2025-02", spend: 12_000 },
      { month: "2025-03", spend: 13_000 },
    ]
    const buckets = buildEvaluationPeriodAccruals(
      series,
      tiers,
      "cumulative",
      "quarterly",
      new Date(Date.UTC(2025, 0, 1)),
      {
        // Bound to end-of-Q1 so subsequent empty quarters don't appear
        // in the result. (The loop emits a row per cadence-bucket up
        // to boundedUntil regardless of whether the series has data.)
        boundedUntil: new Date(Date.UTC(2025, 2, 31, 23, 59, 59, 999)),
        spendBaseline: 100_000,
        growthBased: true,
      },
    )
    expect(buckets.length).toBe(1)
    expect(buckets[0].totalSpend).toBe(40_000)
    expect(buckets[0].rebateEarned).toBe(750)
  })

  it("below-baseline: spend < pro-rated baseline → $0 rebate (no negative slice)", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 5 },
    ]
    const series = twelveMonthsFrom(2025, 5_000) // $60K total, baseline $100K
    const buckets = buildEvaluationPeriodAccruals(
      series,
      tiers,
      "cumulative",
      "annual",
      new Date(Date.UTC(2025, 0, 1)),
      {
        boundedUntil: new Date(Date.UTC(2026, 3, 19)),
        spendBaseline: 100_000,
        growthBased: true,
      },
    )
    expect(buckets.length).toBe(1)
    expect(buckets[0].totalSpend).toBe(60_000)
    // max(0, 60_000 - 100_000) = 0 → no rebate.
    expect(buckets[0].rebateEarned).toBe(0)
  })

  it("growthBased=false (default): full spend reaches the engine even with spendBaseline set", () => {
    // Defensive: passing spendBaseline alone (without growthBased) MUST
    // NOT silently subtract — caller has to opt in. Otherwise turning on
    // a baseline field elsewhere in the form would silently halve every
    // contract's accruals.
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 5 },
    ]
    const series = twelveMonthsFrom(2025, 10_000)
    const buckets = buildEvaluationPeriodAccruals(
      series,
      tiers,
      "cumulative",
      "annual",
      new Date(Date.UTC(2025, 0, 1)),
      {
        boundedUntil: new Date(Date.UTC(2026, 3, 19)),
        spendBaseline: 100_000,
        // growthBased not set
      },
    )
    expect(buckets.length).toBe(1)
    expect(buckets[0].rebateEarned).toBe(6_000) // full $120K × 5%
  })

  it("bugs.rtfd 2026-06-13 #1: baseline 1M, spend 5M, 10% → growth=400K, from-dollar-one=500K", () => {
    // The user's exact spec. Growth chosen → every dollar OVER 1M earns:
    // (5M − 1M) × 10% = 400K. "From dollar one" → full 5M × 10% = 500K.
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 10 },
    ]
    const series = twelveMonthsFrom(2025, 5_000_000 / 12) // $5M total
    const opts = {
      boundedUntil: new Date(Date.UTC(2026, 3, 19)),
      spendBaseline: 1_000_000,
    }
    const anchor = new Date(Date.UTC(2025, 0, 1))
    const growth = buildEvaluationPeriodAccruals(series, tiers, "cumulative", "annual", anchor, {
      ...opts,
      growthBased: true,
    })
    expect(growth[0].rebateEarned).toBeCloseTo(400_000, 2)
    const fromDollarOne = buildEvaluationPeriodAccruals(series, tiers, "cumulative", "annual", anchor, opts)
    expect(fromDollarOne[0].rebateEarned).toBeCloseTo(500_000, 2)
  })
})
