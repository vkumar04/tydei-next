/**
 * Charles W1.W-B2: "Cumulative rebate method not working now."
 *
 * Reproduction & audit:
 *
 * 1. The spec's headline case — tier 1 = 3% @ spendMin $0, tier 2 = 5% @
 *    spendMin $100K, cumulative spend $120K — expected "3% × $100K + 5%
 *    × $20K = $4,000" per Charles's ask. This is BRACKET / layer-cake
 *    math: each tier paid on its own slice. In the codebase that's the
 *    `marginal` method; `cumulative` means "whole spend at top-tier
 *    rate" (see the "Dollar 1 (Cumulative)" tooltip in the contract-
 *    terms-entry form, spec `$750K at tier 3 (3%) → $22,500`). The
 *    $4,000 example therefore describes marginal behavior — we lock it
 *    in as a marginal regression so it can't silently rot.
 *
 * 2. The REAL cumulative bug from the 2026-04-19 contracts-sweep
 *    (BUG-terms-6): when every tier shares `spendMin = 0` (a malformed
 *    seed) the cumulative engine picks the LAST tier regardless of
 *    spend — including at `$0` spend. Root cause in
 *    `calculateCumulative`:
 *
 *        let applicable = sorted[0]
 *        for (const tier of sorted) {
 *          if (spend >= numericValue(tier.spendMin)) applicable = tier
 *        }
 *
 *    For `spend = 0` and every tier at `spendMin = 0`, the loop promotes
 *    through all three tiers and ends on tier 3. Any cumulative-method
 *    display that trusts `tierAchieved` then reads tier 3 at zero spend,
 *    which is what Charles saw as "cumulative not working."
 *
 *    Fix: the tier-selection loop must pick the LOWEST tierNumber among
 *    equal-spendMin candidates at zero spend, and only promote past the
 *    first tier when `spend > tier.spendMin` (strict) — OR when the
 *    current tier is an exact boundary hit AND the next tier's spendMin
 *    is strictly greater. The simplest implementation: skip any tier
 *    whose `spendMin` equals the prior tier's `spendMin` unless spend
 *    strictly exceeds the prior spendMin. This test exercises that
 *    invariant and pins the floor at zero.
 */
import { describe, it, expect } from "vitest"
import {
  calculateCumulative,
  calculateMarginal,
} from "@/lib/contracts/rebate-method"
import type { TierLike } from "@/lib/contracts/rebate-method"

describe("Charles W1.W-B2 — cumulative audit", () => {
  it("'3% × $100K + 5% × $20K = $4,000' is MARGINAL math (documentation)", () => {
    // Charles's example from the ask. In this codebase it's marginal;
    // cumulative on the same inputs returns $6,000 (whole spend at top-
    // tier rate). Both behaviors are locked in so future drift is
    // obvious. If the product ever wants cumulative to step-stack,
    // change the label in the UI and flip this test deliberately.
    const tiers: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: 100_000, rebateValue: 3 },
      { tierNumber: 2, spendMin: 100_000, spendMax: null, rebateValue: 5 },
    ]
    expect(calculateMarginal(120_000, tiers).rebateEarned).toBe(4_000)
    expect(calculateCumulative(120_000, tiers).rebateEarned).toBe(6_000)
  })

  describe("BUG-terms-6 regression: all-zero spendMin tier selection", () => {
    const malformed: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 2 },
      { tierNumber: 2, spendMin: 0, spendMax: null, rebateValue: 3 },
      { tierNumber: 3, spendMin: 0, spendMax: null, rebateValue: 4 },
    ]

    it("zero spend stays on tier 1, NOT the last tier", () => {
      const r = calculateCumulative(0, malformed)
      expect(r.tierAchieved).toBe(1)
      expect(r.rebateEarned).toBe(0)
    })

    it("positive spend with ambiguous tiers still picks the lowest tierNumber", () => {
      // All tiers have spendMin=0 — there is no spend-based way to
      // distinguish them. Picking the highest tierNumber silently
      // inflates rebates (4% instead of 2%). Fall back to the lowest
      // tierNumber so the number stays defensible; config rot must be
      // caught by the validator, not by the math engine.
      const r = calculateCumulative(50_000, malformed)
      expect(r.tierAchieved).toBe(1)
      expect(r.rebateEarned).toBe(1_000) // 50K × 2%
    })
  })

  describe("correct cumulative tier selection (sane tier ladders)", () => {
    const sane: TierLike[] = [
      { tierNumber: 1, spendMin: 0, spendMax: 100_000, rebateValue: 3 },
      { tierNumber: 2, spendMin: 100_000, spendMax: 500_000, rebateValue: 5 },
      { tierNumber: 3, spendMin: 500_000, spendMax: null, rebateValue: 7 },
    ]

    it("spend below tier 1 floor: tier 1 (0)", () => {
      // spendMin=0 — any zero or positive spend qualifies.
      expect(calculateCumulative(0, sane).tierAchieved).toBe(1)
    })

    it("spend at tier-2 threshold promotes to tier 2", () => {
      const r = calculateCumulative(100_000, sane)
      expect(r.tierAchieved).toBe(2)
      expect(r.rebateEarned).toBe(5_000) // 100K × 5%
    })

    it("spend mid-range (tier 2)", () => {
      const r = calculateCumulative(250_000, sane)
      expect(r.tierAchieved).toBe(2)
      expect(r.rebateEarned).toBe(12_500) // 250K × 5%
    })

    it("spend above top threshold: tier 3", () => {
      const r = calculateCumulative(750_000, sane)
      expect(r.tierAchieved).toBe(3)
      expect(r.rebateEarned).toBe(52_500) // 750K × 7%
    })
  })
})
