/**
 * Tests for generateDynamicRebateTiers (spec §subsystem-0).
 *
 * Covers the 3-tier shape, rounding, and the exact rate math from the
 * canonical worked example.
 */

import { describe, it, expect } from "vitest"
import { generateDynamicRebateTiers } from "../rebate-tiers"

describe("generateDynamicRebateTiers", () => {
  it("canonical worked example — $500K baseline, 6% top rate", () => {
    const tiers = generateDynamicRebateTiers({
      baselineSpend: 500_000,
      proposedRebateRate: 6,
    })

    expect(tiers).toHaveLength(3)

    const [base, mid, target] = tiers
    expect(base).toEqual({ name: "Base", minimumSpend: 0, rate: 1.5 })
    // 500_000 × 0.6 = 300_000 (already clean $1K); 6 × 0.6 = 3.6
    expect(mid).toEqual({
      name: "Mid",
      minimumSpend: 300_000,
      rate: 3.6,
    })
    // 500_000 × 1.2 = 600_000; top-tier rate is exact (6).
    expect(target).toEqual({
      name: "Target",
      minimumSpend: 600_000,
      rate: 6,
    })
  })

  it("always returns exactly 3 tiers in Base / Mid / Target order", () => {
    const tiers = generateDynamicRebateTiers({
      baselineSpend: 1_234_567,
      proposedRebateRate: 4.25,
    })
    expect(tiers).toHaveLength(3)
    expect(tiers.map((t) => t.name)).toEqual(["Base", "Mid", "Target"])
  })

  it("tier 3 rate equals proposedRebateRate exactly (no rounding)", () => {
    // Use a rate with more than 2 decimal places to prove it's not
    // pre-rounded on Target.
    const tiers = generateDynamicRebateTiers({
      baselineSpend: 500_000,
      proposedRebateRate: 4.237,
    })
    expect(tiers[2].rate).toBe(4.237)
  })

  it("rounds minimumSpend to nearest $1K", () => {
    // baselineSpend × 0.6 = 315_315 → 315_000 (nearest $1K).
    // baselineSpend × 1.2 = 630_630 → 631_000.
    const tiers = generateDynamicRebateTiers({
      baselineSpend: 525_525,
      proposedRebateRate: 5,
    })
    expect(tiers[1].minimumSpend).toBe(315_000)
    expect(tiers[2].minimumSpend).toBe(631_000)
    // Ensure the numbers are clean multiples of $1K.
    expect(tiers[1].minimumSpend % 1000).toBe(0)
    expect(tiers[2].minimumSpend % 1000).toBe(0)
  })

  it("rounds tier 1 and tier 2 rates to 2 decimals", () => {
    // proposedRebateRate = 3.333 → base = 0.83 (0.83325 rounded),
    // mid = 2.00 (1.9998 rounded).
    const tiers = generateDynamicRebateTiers({
      baselineSpend: 100_000,
      proposedRebateRate: 3.333,
    })
    expect(tiers[0].rate).toBe(0.83)
    expect(tiers[1].rate).toBe(2)
  })

  it("baseline = 0 → all minimums are 0 but rates still compute", () => {
    const tiers = generateDynamicRebateTiers({
      baselineSpend: 0,
      proposedRebateRate: 8,
    })
    expect(tiers.map((t) => t.minimumSpend)).toEqual([0, 0, 0])
    expect(tiers[0].rate).toBe(2) // 8 × 0.25
    expect(tiers[1].rate).toBe(4.8) // 8 × 0.6
    expect(tiers[2].rate).toBe(8)
  })

  it("tier 1 minimum is always 0", () => {
    const tiers = generateDynamicRebateTiers({
      baselineSpend: 999_999,
      proposedRebateRate: 7.5,
    })
    expect(tiers[0].minimumSpend).toBe(0)
  })
})
