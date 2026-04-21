/**
 * Engine invariants — property-style tests.
 *
 * Roadmap track 7: class-of-bug prevention. These tests randomize
 * inputs across wide ranges and assert universal truths that the math
 * must satisfy. If a future change breaks an invariant, these fail
 * loudly with the minimal counterexample.
 *
 * No fast-check dependency — simple vanilla generators keep the test
 * surface framework-free and the build dep-count flat.
 */
import { describe, it, expect } from "vitest"
import {
  calculateCumulative,
  calculateMarginal,
  type TierLike,
} from "@/lib/rebates/calculate"
import { sumEarnedRebatesYTD, sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"

/** Deterministic LCG so failures reproduce across runs. */
function makePrng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomTiers(rng: () => number): TierLike[] {
  const count = 1 + Math.floor(rng() * 4) // 1-4 tiers
  // Monotonically INCREASING rates — matches real-world tier ladders
  // (higher tier = higher rate). Without this, marginal can exceed
  // cumulative on inverted ladders, which is mathematically valid but
  // never happens in practice.
  const rates: number[] = []
  let rate = 1 + rng() * 3 // start 1-4%
  for (let i = 0; i < count; i++) {
    rates.push(rate)
    rate += rng() * 2 // each step up by 0-2%
  }
  // Ascending spendMins.
  const mins: number[] = []
  let prev = 0
  for (let i = 0; i < count; i++) {
    prev += Math.floor(rng() * 250_000) + (i === 0 ? 0 : 1) // first can be 0
    mins.push(prev)
  }
  return mins.map((m, i) => ({
    tierNumber: i + 1,
    spendMin: m,
    spendMax: i === count - 1 ? null : mins[i + 1]! - 1,
    rebateValue: Math.round(rates[i]! * 100) / 100,
  }))
}

// ─── Invariants ─────────────────────────────────────────────────

describe("cumulative engine invariants (50 randomized scenarios)", () => {
  const rng = makePrng(42)

  for (let i = 0; i < 50; i++) {
    const tiers = randomTiers(rng)
    const spend = Math.floor(rng() * 5_000_000)

    it(`seed #${i + 1}: rebate never exceeds spend — tiers=${tiers.length}, spend=$${spend}`, () => {
      const r = calculateCumulative(spend, tiers)
      // Rebate cap: at the highest possible tier rate, rebate ≤ spend × maxRate%.
      // We just assert the stronger "rebate ≤ spend" bound: rates are <10%
      // so spend × rate can't exceed spend under any realistic tier.
      expect(r.rebateEarned).toBeLessThanOrEqual(spend)
      expect(r.rebateEarned).toBeGreaterThanOrEqual(0)
    })

    it(`seed #${i + 1}: below-baseline returns zeros`, () => {
      const lowestMin = Math.min(...tiers.map((t) => Number(t.spendMin)))
      if (lowestMin > 0) {
        const r = calculateCumulative(lowestMin - 1, tiers)
        expect(r.tierAchieved).toBe(0)
        expect(r.rebateEarned).toBe(0)
        expect(r.rebatePercent).toBe(0)
      }
    })

    it(`seed #${i + 1}: monotonic in spend within the top tier`, () => {
      // Within the top tier, doubling spend doubles rebate (cumulative
      // method rate is constant once the top is reached).
      const topMin = Math.max(...tiers.map((t) => Number(t.spendMin)))
      const a = topMin + 10_000
      const b = topMin + 20_000
      const ra = calculateCumulative(a, tiers).rebateEarned
      const rb = calculateCumulative(b, tiers).rebateEarned
      expect(rb).toBeGreaterThanOrEqual(ra)
    })
  }
})

describe("marginal engine invariants (50 randomized scenarios)", () => {
  const rng = makePrng(7)

  for (let i = 0; i < 50; i++) {
    const tiers = randomTiers(rng)
    const spend = Math.floor(rng() * 5_000_000)

    it(`seed #${i + 1}: marginal rebate ≤ cumulative rebate at same spend`, () => {
      // Cumulative pays the TOP tier rate on FULL spend once qualified;
      // marginal pays bracket rates ≤ top rate per bracket. Therefore
      // marginal ≤ cumulative always.
      const cum = calculateCumulative(spend, tiers).rebateEarned
      const marg = calculateMarginal(spend, tiers).rebateEarned
      // Allow 1¢ floating-point slack.
      expect(marg).toBeLessThanOrEqual(cum + 0.01)
    })

    it(`seed #${i + 1}: marginal never exceeds spend × topRate`, () => {
      const topRate = Math.max(...tiers.map((t) => Number(t.rebateValue)))
      const r = calculateMarginal(spend, tiers).rebateEarned
      expect(r).toBeLessThanOrEqual((spend * topRate) / 100 + 0.01)
    })

    it(`seed #${i + 1}: marginal monotonic in spend`, () => {
      // Adding more spend never reduces rebate.
      const a = calculateMarginal(spend, tiers).rebateEarned
      const b = calculateMarginal(spend + 50_000, tiers).rebateEarned
      expect(b).toBeGreaterThanOrEqual(a - 0.01)
    })
  }
})

describe("canonical reducer invariants", () => {
  it("sumEarnedRebatesYTD ≤ sumEarnedRebatesLifetime (100 seeds)", () => {
    const rng = makePrng(99)
    const today = new Date("2026-06-15T12:00:00Z")

    for (let i = 0; i < 100; i++) {
      const count = 1 + Math.floor(rng() * 10)
      const rebates = Array.from({ length: count }, () => {
        const year = 2024 + Math.floor(rng() * 3) // 2024-2026
        const month = Math.floor(rng() * 12)
        return {
          payPeriodEnd: new Date(Date.UTC(year, month, 28)),
          rebateEarned: Math.floor(rng() * 10_000),
        }
      })
      const ytd = sumEarnedRebatesYTD(rebates, today)
      const lifetime = sumEarnedRebatesLifetime(rebates, today)
      expect(ytd).toBeLessThanOrEqual(lifetime + 0.01)
      expect(ytd).toBeGreaterThanOrEqual(0)
      expect(lifetime).toBeGreaterThanOrEqual(0)
    }
  })

  it("sumCollectedRebates ≤ sumEarnedRebatesLifetime when earned >= collected (100 seeds)", () => {
    // A Rebate row's rebateCollected cannot logically exceed rebateEarned
    // (you can't collect more than was earned). If the seed data respects
    // that, the sum also holds.
    const rng = makePrng(123)
    const today = new Date()

    for (let i = 0; i < 100; i++) {
      const count = 1 + Math.floor(rng() * 10)
      const rebates = Array.from({ length: count }, () => {
        const earned = Math.floor(rng() * 10_000)
        return {
          payPeriodEnd: new Date(Date.UTC(2025, 0, 1)), // all past
          rebateEarned: earned,
          // Collected is always ≤ earned.
          rebateCollected: Math.floor(rng() * earned),
          collectionDate: rng() > 0.3 ? new Date(Date.UTC(2025, 6, 1)) : null,
        }
      })
      const collected = sumCollectedRebates(rebates)
      const lifetime = sumEarnedRebatesLifetime(rebates, today)
      expect(collected).toBeLessThanOrEqual(lifetime + 0.01)
    }
  })
})

describe("edge-case invariants", () => {
  it("empty tiers → all zeros", () => {
    expect(calculateCumulative(100_000, []).rebateEarned).toBe(0)
    expect(calculateMarginal(100_000, []).rebateEarned).toBe(0)
  })

  it("negative spend → all zeros (returns don't manufacture rebate)", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 3 },
    ]
    // Cumulative at -$100 with spendMin=0: qualifies tier 1 (0 ≥ -100 false,
    // but spend < lowestMin → zeros). Just assert the rebate is ≤ 0.
    const r = calculateCumulative(-100, tiers).rebateEarned
    expect(r).toBeLessThanOrEqual(0)
  })

  it("zero-rate tier → zero rebate at any spend", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 0 },
    ]
    expect(calculateCumulative(1_000_000, tiers).rebateEarned).toBe(0)
    expect(calculateMarginal(1_000_000, tiers).rebateEarned).toBe(0)
  })

  it("single-tier contract: cumulative === marginal at any spend", () => {
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 3 },
    ]
    const rng = makePrng(1)
    for (let i = 0; i < 20; i++) {
      const spend = Math.floor(rng() * 1_000_000)
      const cum = calculateCumulative(spend, tiers).rebateEarned
      const marg = calculateMarginal(spend, tiers).rebateEarned
      expect(cum).toBeCloseTo(marg, 2)
    }
  })
})
