/**
 * Pins the WIDENED canonical accrual-projection helper
 * (`lib/contracts/rebate-accrual-schedule.ts`), which now owns three things
 * the DCF surfaces depend on and which nobody may hand-roll downstream:
 *
 *   1. flat-dollar (`fixedRebateAmount`) tiers, delegated to the shared
 *      engine's cumulative/marginal short-circuit,
 *   2. per-period qualifying-spend narrowing — `periodCap` then a pro-rated
 *      growth baseline — with the slices ACCUMULATING period by period,
 *   3. `annualizePeriodCap`, the cadence → per-year cap conversion.
 *
 * Companion to `rebate-accrual-schedule.test.ts`, which covers the original
 * percent-only, un-narrowed behaviour. Nothing here duplicates that file.
 */
import { describe, it, expect } from "vitest"
import {
  annualizePeriodCap,
  projectRebateAccrualSchedule,
  type AccrualTier,
} from "@/lib/contracts/rebate-accrual-schedule"
import { buildEvaluationPeriodAccruals } from "@/lib/contracts/accrual"

/** Percent ladder used by the "unchanged behaviour" + narrowing cases. */
const percentLadder: AccrualTier[] = [
  { spendMin: 0, spendMax: 50_000, rebateValue: 2 },
  { spendMin: 50_000, spendMax: null, rebateValue: 4 },
]

describe("projectRebateAccrualSchedule — flat-dollar tiers", () => {
  // rebateValue 0 + fixedRebateAmount 30_000 is exactly the shape the
  // recompute adapter emits for `rebateType = fixed_rebate`
  // (see lib/rebates/__tests__/fixed-rebate-accrual.test.ts).
  const flatSingleTier: AccrualTier[] = [
    { spendMin: 0, spendMax: null, rebateValue: 0, fixedRebateAmount: 30_000 },
  ]

  it("cumulative: pays the flat $30,000 EVERY period once qualified, at a 0% rate", () => {
    const out = projectRebateAccrualSchedule({
      tiers: flatSingleTier,
      periodProjections: [
        { periodNumber: 1, projectedSpend: 100_000 },
        { periodNumber: 2, projectedSpend: 100_000 },
        { periodNumber: 3, projectedSpend: 100_000 },
      ],
      method: "cumulative",
      boundaryRule: "exclusive",
    })

    // A flat-dollar tier is a PER-PERIOD payout, so the cumulative-delta model
    // does not apply to it: the engine short-circuits to a constant, and
    // subtracting the prior cumulative would pay $30,000 once and $0 for every
    // period after. buildEvaluationPeriodAccruals — which writes the persisted
    // Rebate rows — runs the engine per evaluation window and takes
    // rebateEarned whole, i.e. $30,000 every window. These must agree.
    expect(out.map((r) => r.projectedRebate)).toEqual([30_000, 30_000, 30_000])
    expect(out.reduce((s, r) => s + r.projectedRebate, 0)).toBe(90_000)

    // A flat tier has NO percent rate — the UI renders the dollars instead.
    // 30_000 leaking into this field would be read as "3,000,000% of spend".
    for (const row of out) {
      expect(row.rebateAccrualPercent).toBe(0)
      expect(row.achievedTier).toBe(1)
    }
  })

  it("cumulative: never scales the flat amount by spend", () => {
    const small = projectRebateAccrualSchedule({
      tiers: flatSingleTier,
      periodProjections: [{ periodNumber: 1, projectedSpend: 100_000 }],
      method: "cumulative",
      boundaryRule: "exclusive",
    })
    const large = projectRebateAccrualSchedule({
      tiers: flatSingleTier,
      periodProjections: [{ periodNumber: 1, projectedSpend: 5_000_000 }],
      method: "cumulative",
      boundaryRule: "exclusive",
    })
    expect(small[0]!.projectedRebate).toBe(30_000)
    expect(large[0]!.projectedRebate).toBe(30_000)
  })

  it("marginal: pays EACH traversed bracket's flat amount", () => {
    // Two flat brackets: [0, 100k) → $30,000 and [100k, ∞) → $50,000.
    const flatLadder: AccrualTier[] = [
      {
        spendMin: 0,
        spendMax: 100_000,
        rebateValue: 0,
        fixedRebateAmount: 30_000,
      },
      {
        spendMin: 100_000,
        spendMax: null,
        rebateValue: 0,
        fixedRebateAmount: 50_000,
      },
    ]

    const marginal = projectRebateAccrualSchedule({
      tiers: flatLadder,
      periodProjections: [
        { periodNumber: 1, projectedSpend: 60_000 },
        { periodNumber: 2, projectedSpend: 100_000 },
      ],
      method: "marginal",
      boundaryRule: "exclusive",
    })

    // calculateMarginalRebate stacks fixedRebateAmount per bracket whose
    // bracketSpend > 0 (lib/rebates/engine/shared/marginal.ts):
    //   at 60k  → bracket 1 spend 60k    → $30,000; bracket 2 spend ≤ 0 → skip
    //   at 160k → bracket 1 spend 100k   → $30,000
    //             bracket 2 spend 60k    → $50,000  ⇒ engine total $80,000
    // Flat amounts are per-period payouts, so each period earns the engine's
    // figure at that period's cumulative qualifying spend — not a delta.
    expect(marginal.map((r) => r.projectedRebate)).toEqual([30_000, 80_000])
    expect(marginal.reduce((s, r) => s + r.projectedRebate, 0)).toBe(110_000)

    // The same ladder under `cumulative` pays only the ACHIEVED tier's amount
    // each period — $30,000 then $50,000, never the $80,000 stack. Pinning both
    // stops anyone reconciling the two by hand-rolling math in this helper.
    const cumulative = projectRebateAccrualSchedule({
      tiers: flatLadder,
      periodProjections: [
        { periodNumber: 1, projectedSpend: 60_000 },
        { periodNumber: 2, projectedSpend: 100_000 },
      ],
      method: "cumulative",
      boundaryRule: "exclusive",
    })
    expect(cumulative.map((r) => r.projectedRebate)).toEqual([30_000, 50_000])
    expect(cumulative.reduce((s, r) => s + r.projectedRebate, 0)).toBe(80_000)
    expect(cumulative[1]!.achievedTier).toBe(2)
    expect(cumulative[1]!.rebateAccrualPercent).toBe(0)
  })

  it("agrees with the canonical accrual writer on a flat-dollar term", () => {
    // The invariant the cadence fix exists for: this projection and the helper
    // that writes the persisted Rebate rows must report the same dollars for
    // the same term. Before the fix the projection paid $30,000 once and $0
    // for every year after, against the writer's $30,000 per year.
    const YEARS = 5
    const MONTHLY = 100_000

    const projected = projectRebateAccrualSchedule({
      tiers: flatSingleTier,
      periodProjections: Array.from({ length: YEARS }, (_, i) => ({
        periodNumber: i + 1,
        projectedSpend: MONTHLY * 12,
      })),
      method: "cumulative",
      boundaryRule: "exclusive",
    })

    const series = Array.from({ length: YEARS * 12 }, (_, i) => ({
      month: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
      spend: MONTHLY,
    }))
    const written = buildEvaluationPeriodAccruals(
      series,
      [
        {
          tierNumber: 1,
          tierName: null,
          spendMin: 0,
          spendMax: null,
          rebateValue: 0,
          fixedRebateAmount: 30_000,
        },
      ],
      "cumulative",
      "annual",
      new Date(Date.UTC(2024, 0, 1)),
    )

    expect(projected.map((p) => p.projectedRebate)).toEqual(
      written.map((w) => w.rebateEarned),
    )
    expect(projected.reduce((s, p) => s + p.projectedRebate, 0)).toBe(150_000)
  })
})

describe("projectRebateAccrualSchedule — percent ladders are untouched by the widening", () => {
  const periods = [
    { periodNumber: 1, projectedSpend: 25_000 },
    { periodNumber: 2, projectedSpend: 35_000 },
    { periodNumber: 3, projectedSpend: 40_000 },
  ]

  it("an omitted fixedRebateAmount and an explicit null are deep-equal", () => {
    const omitted = projectRebateAccrualSchedule({
      tiers: percentLadder,
      periodProjections: periods,
      method: "cumulative",
      boundaryRule: "exclusive",
    })
    const explicitNull = projectRebateAccrualSchedule({
      tiers: percentLadder.map((t) => ({ ...t, fixedRebateAmount: null })),
      periodProjections: periods,
      method: "cumulative",
      boundaryRule: "exclusive",
    })
    expect(explicitNull).toEqual(omitted)

    const marginalOmitted = projectRebateAccrualSchedule({
      tiers: percentLadder,
      periodProjections: periods,
      method: "marginal",
      boundaryRule: "exclusive",
    })
    const marginalNull = projectRebateAccrualSchedule({
      tiers: percentLadder.map((t) => ({ ...t, fixedRebateAmount: null })),
      periodProjections: periods,
      method: "marginal",
      boundaryRule: "exclusive",
    })
    expect(marginalNull).toEqual(marginalOmitted)
  })

  it("percent-only numbers are byte-identical to the pre-widening arithmetic", () => {
    const out = projectRebateAccrualSchedule({
      tiers: percentLadder,
      periodProjections: periods,
      method: "cumulative",
      boundaryRule: "exclusive",
    })
    // cumulative 25k / 60k / 100k under [0,50k)=2%, [50k,∞)=4%:
    //   25,000 × 2% =    500 → delta   500
    //   60,000 × 4% =  2,400 → delta 1,900
    //  100,000 × 4% =  4,000 → delta 1,600
    expect(out.map((r) => r.projectedRebate)).toEqual([500, 1_900, 1_600])
    expect(out.map((r) => r.achievedTier)).toEqual([1, 2, 2])
    expect(out.map((r) => r.rebateAccrualPercent)).toEqual([2, 4, 4])
  })

  it("with no cap and no baseline the new fields are pass-throughs", () => {
    const out = projectRebateAccrualSchedule({
      tiers: percentLadder,
      periodProjections: periods,
      method: "cumulative",
      boundaryRule: "exclusive",
    })
    expect(out.map((r) => r.qualifyingSpend)).toEqual([25_000, 35_000, 40_000])
    expect(out.map((r) => r.cumulativeQualifyingSpend)).toEqual([
      25_000, 60_000, 100_000,
    ])
    expect(out.map((r) => r.cumulativeSpend)).toEqual([25_000, 60_000, 100_000])
    expect(out.map((r) => r.growthBaselineApplied)).toEqual([0, 0, 0])
    expect(out.map((r) => r.capApplied)).toEqual([0, 0, 0])
  })
})

describe("projectRebateAccrualSchedule — growth baseline", () => {
  it("subtracts the baseline PER PERIOD and accumulates the slices", () => {
    const out = projectRebateAccrualSchedule({
      tiers: percentLadder,
      periodProjections: [
        { periodNumber: 1, projectedSpend: 4_200_000 },
        { periodNumber: 2, projectedSpend: 4_200_000 },
        { periodNumber: 3, projectedSpend: 4_200_000 },
      ],
      method: "cumulative",
      boundaryRule: "exclusive",
      growthOnly: true,
      spendBaseline: 4_000_000,
    })

    // Each period clears its own $4.0M floor: 4.2M − 4.0M = 200k.
    expect(out.map((r) => r.qualifyingSpend)).toEqual([
      200_000, 200_000, 200_000,
    ])
    expect(out.map((r) => r.growthBaselineApplied)).toEqual([
      4_000_000, 4_000_000, 4_000_000,
    ])

    // The slices ACCUMULATE: 200k → 400k → 600k.
    expect(out.map((r) => r.cumulativeQualifyingSpend)).toEqual([
      200_000, 400_000, 600_000,
    ])

    // Explicitly NOT max(0, cumulativeSpend − baseline), which would charge
    // the floor exactly once and hand periods 2/3 the whole prior spend:
    //   4.2M − 4M = 200k, 8.4M − 4M = 4.4M, 12.6M − 4M = 8.6M.
    expect(out[1]!.cumulativeQualifyingSpend).not.toBe(4_400_000)
    expect(out[2]!.cumulativeQualifyingSpend).not.toBe(8_600_000)

    // Gross spend is untouched by the baseline — it is the display basis.
    expect(out.map((r) => r.cumulativeSpend)).toEqual([
      4_200_000, 8_400_000, 12_600_000,
    ])
  })

  it("a shortfall period contributes 0, never a negative that offsets a growth period", () => {
    const out = projectRebateAccrualSchedule({
      tiers: [
        { spendMin: 0, spendMax: 500_000, rebateValue: 1 },
        { spendMin: 500_000, spendMax: null, rebateValue: 3 },
      ],
      periodProjections: [
        { periodNumber: 1, projectedSpend: 3_000_000 }, // $1M SHORT of the floor
        { periodNumber: 2, projectedSpend: 5_000_000 }, // $1M above the floor
      ],
      method: "cumulative",
      boundaryRule: "exclusive",
      growthOnly: true,
      spendBaseline: 4_000_000,
    })

    // Period 1: max(0, 3M − 4M) = 0, NOT −1,000,000.
    expect(out[0]!.qualifyingSpend).toBe(0)
    expect(out[0]!.qualifyingSpend).not.toBe(-1_000_000)
    // Only the spend that actually existed can be removed by the floor.
    expect(out[0]!.growthBaselineApplied).toBe(3_000_000)
    expect(out[0]!.cumulativeQualifyingSpend).toBe(0)
    expect(out[0]!.projectedRebate).toBe(0)

    // Period 2 keeps its full $1M of growth. A "cumulative − N × baseline"
    // (or a signed per-period slice) would net the −$1M shortfall against it
    // and report $0 of qualifying spend for the whole term.
    expect(out[1]!.qualifyingSpend).toBe(1_000_000)
    expect(out[1]!.cumulativeQualifyingSpend).toBe(1_000_000)
    expect(out[1]!.cumulativeQualifyingSpend).not.toBe(0)

    // $1M qualifying → tier 2 → 1,000,000 × 3% = $30,000.
    expect(out[1]!.achievedTier).toBe(2)
    expect(out[1]!.rebateAccrualPercent).toBe(3)
    expect(out[1]!.projectedRebate).toBeCloseTo(30_000, 6)
  })

  it("growthOnly false leaves the baseline inert", () => {
    const out = projectRebateAccrualSchedule({
      tiers: percentLadder,
      periodProjections: [{ periodNumber: 1, projectedSpend: 4_200_000 }],
      method: "cumulative",
      boundaryRule: "exclusive",
      growthOnly: false,
      spendBaseline: 4_000_000,
    })
    expect(out[0]!.qualifyingSpend).toBe(4_200_000)
    expect(out[0]!.growthBaselineApplied).toBe(0)
    expect(out[0]!.cumulativeQualifyingSpend).toBe(4_200_000)
  })

  it("periodMonths pro-rates the annual baseline (3 months → baseline / 4)", () => {
    const out = projectRebateAccrualSchedule({
      tiers: percentLadder,
      periodProjections: [{ periodNumber: 1, projectedSpend: 1_250_000 }],
      method: "cumulative",
      boundaryRule: "exclusive",
      growthOnly: true,
      spendBaseline: 4_000_000,
      periodMonths: 3,
    })
    // 4,000,000 × 3/12 = 1,000,000 → 1,250,000 − 1,000,000 = 250,000.
    expect(out[0]!.growthBaselineApplied).toBe(1_000_000)
    expect(out[0]!.qualifyingSpend).toBe(250_000)
  })
})

describe("projectRebateAccrualSchedule — period cap", () => {
  it("clamps spend BEFORE the baseline and reports the removed dollars", () => {
    const out = projectRebateAccrualSchedule({
      tiers: percentLadder,
      periodProjections: [{ periodNumber: 1, projectedSpend: 5_000_000 }],
      method: "cumulative",
      boundaryRule: "exclusive",
      periodCap: 3_000_000,
      growthOnly: true,
      spendBaseline: 1_000_000,
    })
    // Cap first: min(5M, 3M) = 3M, capApplied 2M; then 3M − 1M = 2M.
    // Baseline first would give (5M − 1M) = 4M, capped to 3M — a $1M
    // over-statement of qualifying spend.
    expect(out[0]!.capApplied).toBe(2_000_000)
    expect(out[0]!.growthBaselineApplied).toBe(1_000_000)
    expect(out[0]!.qualifyingSpend).toBe(2_000_000)
    expect(out[0]!.qualifyingSpend).not.toBe(3_000_000)
  })

  it("a cap larger than spend removes nothing", () => {
    const out = projectRebateAccrualSchedule({
      tiers: percentLadder,
      periodProjections: [{ periodNumber: 1, projectedSpend: 4_000_000 }],
      method: "cumulative",
      boundaryRule: "exclusive",
      periodCap: 10_000_000,
    })
    expect(out[0]!.capApplied).toBe(0)
    expect(out[0]!.qualifyingSpend).toBe(4_000_000)
  })

  it("a negative or non-finite cap is ignored", () => {
    const spend = [{ periodNumber: 1, projectedSpend: 4_000_000 }]
    for (const badCap of [-1, -5_000_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = projectRebateAccrualSchedule({
        tiers: percentLadder,
        periodProjections: spend,
        method: "cumulative",
        boundaryRule: "exclusive",
        periodCap: badCap,
      })
      // A negative cap must not zero the projection out, and NaN must not
      // poison qualifyingSpend into NaN.
      expect(out[0]!.capApplied).toBe(0)
      expect(out[0]!.qualifyingSpend).toBe(4_000_000)
      expect(Number.isFinite(out[0]!.projectedRebate)).toBe(true)
    }
  })

  it("cap slices accumulate per period rather than against the running total", () => {
    const out = projectRebateAccrualSchedule({
      tiers: percentLadder,
      periodProjections: [
        { periodNumber: 1, projectedSpend: 80_000 },
        { periodNumber: 2, projectedSpend: 80_000 },
      ],
      method: "cumulative",
      boundaryRule: "exclusive",
      periodCap: 50_000,
    })
    expect(out.map((r) => r.capApplied)).toEqual([30_000, 30_000])
    expect(out.map((r) => r.qualifyingSpend)).toEqual([50_000, 50_000])
    expect(out.map((r) => r.cumulativeQualifyingSpend)).toEqual([
      50_000, 100_000,
    ])
    // Gross spend ignores the cap entirely.
    expect(out.map((r) => r.cumulativeSpend)).toEqual([80_000, 160_000])
  })
})

describe("projectRebateAccrualSchedule — gross vs qualifying spend", () => {
  it("keeps cumulativeSpend gross while tier lookup follows cumulativeQualifyingSpend", () => {
    const out = projectRebateAccrualSchedule({
      tiers: [
        { spendMin: 0, spendMax: 1_000_000, rebateValue: 1 },
        { spendMin: 1_000_000, spendMax: null, rebateValue: 5 },
      ],
      periodProjections: [{ periodNumber: 1, projectedSpend: 4_200_000 }],
      method: "cumulative",
      boundaryRule: "exclusive",
      growthOnly: true,
      spendBaseline: 4_000_000,
    })

    // The two figures genuinely differ.
    expect(out[0]!.cumulativeSpend).toBe(4_200_000)
    expect(out[0]!.cumulativeQualifyingSpend).toBe(200_000)

    // Tier lookup runs against the QUALIFYING figure: $200k → tier 1 @ 1%.
    // Running it against the gross $4.2M would land tier 2 @ 5% and report
    // 4,200,000 × 5% = $210,000 instead of 200,000 × 1% = $2,000.
    expect(out[0]!.achievedTier).toBe(1)
    expect(out[0]!.rebateAccrualPercent).toBe(1)
    expect(out[0]!.projectedRebate).toBeCloseTo(2_000, 6)
    expect(out[0]!.projectedRebate).not.toBeCloseTo(210_000, 6)
  })
})

describe("annualizePeriodCap", () => {
  it("scales each cadence up to one year", () => {
    expect(annualizePeriodCap(100_000, "monthly", 5)).toBe(1_200_000)
    expect(annualizePeriodCap(100_000, "quarterly", 5)).toBe(400_000)
    expect(annualizePeriodCap(100_000, "semi_annual", 5)).toBe(200_000)
    expect(annualizePeriodCap(100_000, "annual", 5)).toBe(100_000)
  })

  it("spreads a lifetime cap evenly across the term", () => {
    // One $1,000,000 ceiling for a 5-year term → $200,000 of headroom/year.
    expect(annualizePeriodCap(1_000_000, "lifetime", 5)).toBe(200_000)
    expect(annualizePeriodCap(1_000_000, "lifetime", 4)).toBe(250_000)
    // Guard against divide-by-zero on a malformed term.
    expect(annualizePeriodCap(1_000_000, "lifetime", 0)).toBe(1_000_000)
  })

  it("returns null for an absent, negative, or non-finite cap", () => {
    expect(annualizePeriodCap(null, "monthly", 5)).toBeNull()
    expect(annualizePeriodCap(undefined, "monthly", 5)).toBeNull()
    expect(annualizePeriodCap(-1, "monthly", 5)).toBeNull()
    expect(annualizePeriodCap(Number.NaN, "monthly", 5)).toBeNull()
    expect(annualizePeriodCap(Number.POSITIVE_INFINITY, "monthly", 5)).toBeNull()
  })

  it("passes an unknown cadence through unscaled", () => {
    // Unknown cadence: return the raw cap rather than guessing a multiplier.
    expect(annualizePeriodCap(100_000, "biweekly", 5)).toBe(100_000)
    expect(annualizePeriodCap(100_000, "", 5)).toBe(100_000)
    // A zero cap is a real ceiling, not "absent" — it must survive.
    expect(annualizePeriodCap(0, "monthly", 5)).toBe(0)
  })
})
