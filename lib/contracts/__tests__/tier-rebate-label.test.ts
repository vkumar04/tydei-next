import { describe, it, expect } from "vitest"
import { formatTierRebateLabel } from "@/lib/contracts/tier-rebate-label"

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
