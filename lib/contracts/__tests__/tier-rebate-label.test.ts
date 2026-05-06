import { describe, it, expect } from "vitest"
import {
  formatTierRebateLabel,
  formatTierDollarAnnotation,
} from "@/lib/contracts/tier-rebate-label"

describe("formatTierRebateLabel", () => {
  describe("percent_of_spend", () => {
    it("renders a fractional rebateValue as a whole-number percentage", () => {
      // Regression: seed data stores 0.02 for 2%; the Terms & Tiers tab
      // used to call formatPercent(0.02) which returned "0.0%".
      expect(formatTierRebateLabel("percent_of_spend", 0.02)).toBe("2.0%")
      expect(formatTierRebateLabel("percent_of_spend", 0.04)).toBe("4.0%")
      expect(formatTierRebateLabel("percent_of_spend", 0.06)).toBe("6.0%")
    })

    it("renders a half-percent fractional value with one decimal place", () => {
      expect(formatTierRebateLabel("percent_of_spend", 0.015)).toBe("1.5%")
      expect(formatTierRebateLabel("percent_of_spend", 0.035)).toBe("3.5%")
    })

    it("renders zero as 0.0%", () => {
      expect(formatTierRebateLabel("percent_of_spend", 0)).toBe("0.0%")
    })
  })

  describe("non-percent rebate types", () => {
    it("renders fixed_rebate_per_unit as precise currency", () => {
      expect(formatTierRebateLabel("fixed_rebate_per_unit", 50)).toBe("$50.00")
      expect(formatTierRebateLabel("fixed_rebate_per_unit", 75)).toBe("$75.00")
    })

    it("renders fixed_rebate as precise currency", () => {
      expect(formatTierRebateLabel("fixed_rebate", 1000)).toBe("$1,000.00")
    })

    it("renders per_procedure_rebate as precise currency", () => {
      expect(formatTierRebateLabel("per_procedure_rebate", 25)).toBe("$25.00")
    })
  })
})

describe("formatTierDollarAnnotation — Bug #3 (sub-threshold projection)", () => {
  // Regression for the Distal Extremities scoped-category rebate:
  // tier 1 spendMin = $825,000 @ 2%. Scoped current spend = $302,650
  // (well below the $825k floor). The display previously read
  // "top rate — projects $6,053 at current spend" (= 2% × $302,650),
  // implying a phantom rebate. Below-threshold spend must surface as
  // "to unlock", never as a top-rate projection.
  const tier = {
    tierNumber: 1,
    spendMin: 825000,
    spendMax: null,
    rebateType: "percent_of_spend" as const,
    rebateValue: 0.02,
  }

  it("renders 'to unlock' when scoped spend is below tier 1's floor", () => {
    const out = formatTierDollarAnnotation(
      tier,
      302650, // current scoped spend
      0, // currentTierNumber = 0 (below baseline sentinel)
      false, // isTopTier — irrelevant when below baseline
    )
    expect(out).toBe("$522,350 to unlock")
    expect(out).not.toMatch(/top rate/i)
    expect(out).not.toMatch(/\$6,053/)
  })

  it("renders top-rate projection only when spend has actually reached the tier", () => {
    const out = formatTierDollarAnnotation(
      tier,
      900000, // current scoped spend over the floor
      1, // currentTierNumber = 1 (matched)
      true, // isTopTier
    )
    expect(out).toBe("top rate — projects $18,000 at current spend")
  })
})
