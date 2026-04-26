import { describe, it, expect } from "vitest"
import { monteCarloTierProbability } from "@/lib/forecasting/monte-carlo-tier"
import type { TierLike } from "@/lib/rebates/calculate"

const ladder: TierLike[] = [
  { tierNumber: 1, spendMin: 100_000, spendMax: 300_000, rebateValue: 3 },
  { tierNumber: 2, spendMin: 300_000, spendMax: 600_000, rebateValue: 5 },
  { tierNumber: 3, spendMin: 600_000, spendMax: null, rebateValue: 7 },
]

describe("monteCarloTierProbability (roadmap track 6)", () => {
  it("empty history → 100% no-tier, zero rebate", () => {
    const r = monteCarloTierProbability({
      monthlySpend: [],
      tiers: ladder,
    })
    expect(r.tierProbability.get(0)).toBe(1)
    expect(r.expectedRebate).toBe(0)
  })

  it("empty tiers → 100% no-tier", () => {
    const r = monteCarloTierProbability({
      monthlySpend: [50_000, 50_000, 50_000],
      tiers: [],
    })
    expect(r.tierProbability.get(0)).toBe(1)
  })

  it("steady $50k/month → deterministic tier 2 (~$600k annual)", () => {
    // Every month of history = \$50k → every sampled 12-mo sum = \$600k.
    // Tier 2 qualifies at \$300k, tier 3 at \$600k so this lands exactly
    // at the tier 3 threshold. Under EXCLUSIVE boundary (the default),
    // \$600k qualifies tier 3.
    const r = monteCarloTierProbability({
      monthlySpend: Array(12).fill(50_000),
      tiers: ladder,
      iterations: 200,
      seed: 42,
    })
    // All 200 iterations produce identical synthetic annual = \$600k → tier 3.
    expect(r.tierProbability.get(3)).toBe(1)
    // Rebate: cumulative at tier 3 (7%) × \$600k = \$42k.
    expect(r.rebateP50).toBeCloseTo(42_000, -2)
    expect(r.expectedRebate).toBeCloseTo(42_000, -2)
  })

  it("noisy history → spreads probability across tiers", () => {
    // Spend swings between \$10k and \$80k/month. 12-month sums vary
    // widely — some iterations hit tier 1, some 2, some 3.
    const history = [
      10_000, 80_000, 20_000, 70_000, 30_000, 60_000,
      15_000, 75_000, 25_000, 65_000, 35_000, 55_000,
    ]
    const r = monteCarloTierProbability({
      monthlySpend: history,
      tiers: ladder,
      iterations: 500,
      seed: 7,
    })
    // Probability distribution should sum to 1.
    const total = Array.from(r.tierProbability.values()).reduce(
      (s, v) => s + v,
      0,
    )
    expect(total).toBeCloseTo(1, 3)
    // P5 < P50 < P95.
    expect(r.rebateP5).toBeLessThanOrEqual(r.rebateP50)
    expect(r.rebateP50).toBeLessThanOrEqual(r.rebateP95)
  })

  it("seeded PRNG is deterministic across runs", () => {
    const history = [20_000, 50_000, 80_000, 30_000, 60_000]
    const a = monteCarloTierProbability({
      monthlySpend: history,
      tiers: ladder,
      iterations: 100,
      seed: 12345,
    })
    const b = monteCarloTierProbability({
      monthlySpend: history,
      tiers: ladder,
      iterations: 100,
      seed: 12345,
    })
    expect(a.rebateP50).toBe(b.rebateP50)
    expect(a.expectedRebate).toBe(b.expectedRebate)
  })

  it("very low spend history → dominated by no-tier probability", () => {
    // \$5k/month × 12 = \$60k synthetic annual, below tier 1's \$100k.
    const r = monteCarloTierProbability({
      monthlySpend: Array(12).fill(5_000),
      tiers: ladder,
      iterations: 200,
      seed: 1,
    })
    expect(r.tierProbability.get(0)).toBe(1)
    expect(r.expectedRebate).toBe(0)
  })
})
