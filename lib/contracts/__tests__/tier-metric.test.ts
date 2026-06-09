import { describe, expect, it } from "vitest"
import {
  pickThresholdMetric,
  isSpendDollarThresholdTermType,
  hasSpendDollarTierLadder,
} from "@/lib/contracts/tier-metric"

describe("pickThresholdMetric", () => {
  const metrics = {
    currentSpend: 1_234_567,
    currentMarketShare: 92.6,
    complianceRate: 78.2,
    currentVolume: 412,
  }

  it("market_share → currentMarketShare", () => {
    expect(pickThresholdMetric("market_share", metrics)).toBe(92.6)
  })

  it("compliance_rebate → complianceRate", () => {
    expect(pickThresholdMetric("compliance_rebate", metrics)).toBe(78.2)
  })

  it.each([
    "volume_rebate",
    "rebate_per_use",
    "capitated_pricing_rebate",
    "po_rebate",
    "payment_rebate",
  ])("%s → currentVolume", (termType) => {
    expect(pickThresholdMetric(termType, metrics)).toBe(412)
  })

  it.each(["spend_rebate", "growth_rebate", "carve_out", "tie_in", "unknown_termtype"])(
    "%s → currentSpend (default)",
    (termType) => {
      expect(pickThresholdMetric(termType, metrics)).toBe(1_234_567)
    },
  )

  it("returns 0 when the relevant metric is null", () => {
    expect(
      pickThresholdMetric("market_share", { ...metrics, currentMarketShare: null }),
    ).toBe(0)
    expect(
      pickThresholdMetric("compliance_rebate", { ...metrics, complianceRate: null }),
    ).toBe(0)
    expect(
      pickThresholdMetric("volume_rebate", { ...metrics, currentVolume: null }),
    ).toBe(0)
  })
})

describe("isSpendDollarThresholdTermType", () => {
  // 2026-06-08: the spend × rate utilization card must only run for term
  // types whose tier `spendMin` is dollars. market_share (% threshold) and
  // count-based types must be excluded — feeding them dollar spend always
  // "achieves" the top tier (spend ≫ a 0–100 % threshold).
  it.each(["spend_rebate", "carve_out", "tie_in", "price_reduction", "unknown_termtype"])(
    "%s → spend-dollar threshold (true)",
    (termType) => {
      expect(isSpendDollarThresholdTermType(termType)).toBe(true)
    },
  )

  it.each([
    "market_share",
    "compliance_rebate",
    "volume_rebate",
    "rebate_per_use",
    "capitated_pricing_rebate",
    "po_rebate",
    "payment_rebate",
  ])("%s → NOT spend-dollar threshold (false)", (termType) => {
    expect(isSpendDollarThresholdTermType(termType)).toBe(false)
  })

  it("mirrors pickThresholdMetric: false exactly when the metric is not currentSpend", () => {
    const probe = {
      currentSpend: 999,
      currentMarketShare: 1,
      complianceRate: 1,
      currentVolume: 1,
    }
    for (const tt of [
      "spend_rebate",
      "carve_out",
      "tie_in",
      "market_share",
      "compliance_rebate",
      "volume_rebate",
      "rebate_per_use",
      "capitated_pricing_rebate",
      "po_rebate",
      "payment_rebate",
    ]) {
      const usesSpend = pickThresholdMetric(tt, probe) === probe.currentSpend
      expect(isSpendDollarThresholdTermType(tt)).toBe(usesSpend)
    }
  })
})

describe("hasSpendDollarTierLadder", () => {
  // 2026-06-08 (Charles "carve out has NOT tiers but it has tiers 4,3,7" +
  // "rebate utilization not calculating"): the Tier Achievement and Rebate
  // utilization surfaces must read tiers ONLY from a term with a REAL
  // spend-dollar ladder. `isSpendDollarThresholdTermType` alone is too
  // loose — carve_out/tie_in pass it but earn per-SKU, and their auto-created
  // placeholder tier (rebateValue 0) produced bogus tiers / a false 0.0%.
  const realLadder = [
    { rebateValue: 0.02 },
    { rebateValue: 0.04 },
  ]

  it("true for a spend_rebate term with a non-zero tier ladder", () => {
    expect(
      hasSpendDollarTierLadder({ termType: "spend_rebate", tiers: realLadder }),
    ).toBe(true)
  })

  it("false for a carve_out term even with a (placeholder) tier", () => {
    // Auto-created carve-out term: single placeholder tier, rebateValue 0.
    expect(
      hasSpendDollarTierLadder({
        termType: "carve_out",
        tiers: [{ rebateValue: 0 }],
      }),
    ).toBe(false)
    // …and even if a carve_out term somehow carried a non-zero tier, it
    // still earns per-SKU, so it never drives a spend-tier surface.
    expect(
      hasSpendDollarTierLadder({ termType: "carve_out", tiers: realLadder }),
    ).toBe(false)
  })

  it("false for a tie_in term", () => {
    expect(
      hasSpendDollarTierLadder({ termType: "tie_in", tiers: realLadder }),
    ).toBe(false)
  })

  it("false for a market_share term (percent thresholds, not dollars)", () => {
    // This is the term that produced the bogus "Tier 4/3/7" on a carve-out
    // tie-in — percent thresholds (0/50/65) in spendMin with many tiers.
    expect(
      hasSpendDollarTierLadder({
        termType: "market_share",
        tiers: [{ rebateValue: 0.03 }, { rebateValue: 0.05 }],
      }),
    ).toBe(false)
  })

  it("false for a spend term with only zero-value tiers", () => {
    expect(
      hasSpendDollarTierLadder({
        termType: "spend_rebate",
        tiers: [{ rebateValue: 0 }, { rebateValue: 0 }],
      }),
    ).toBe(false)
  })

  it("false for a spend term with no tiers", () => {
    expect(
      hasSpendDollarTierLadder({ termType: "spend_rebate", tiers: [] }),
    ).toBe(false)
  })
})
