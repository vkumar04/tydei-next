import { describe, it, expect } from "vitest"
import {
  toDisplayRebateValue,
  fromDisplayRebateValue,
  normalizeAIRebateValue,
  isPercentRebateType,
} from "@/lib/contracts/rebate-value-normalize"

describe("rebate-value-normalize", () => {
  describe("isPercentRebateType", () => {
    it("treats percent_of_spend as percent-denominated", () => {
      expect(isPercentRebateType("percent_of_spend")).toBe(true)
    })

    it("treats dollar rebate types as non-percent", () => {
      expect(isPercentRebateType("fixed_rebate")).toBe(false)
      expect(isPercentRebateType("fixed_rebate_per_unit")).toBe(false)
      expect(isPercentRebateType("per_procedure_rebate")).toBe(false)
    })
  })

  describe("toDisplayRebateValue (load)", () => {
    it("denormalizes percent_of_spend fraction → percent", () => {
      expect(toDisplayRebateValue("percent_of_spend", 0.03)).toBe(3)
      expect(toDisplayRebateValue("percent_of_spend", 0.025)).toBe(2.5)
      expect(toDisplayRebateValue("percent_of_spend", 0)).toBe(0)
    })

    it("avoids floating point fuzz (0.03 * 100 = 3.0000000000000004)", () => {
      // Without rounding, 0.03 * 100 in JS is 3.0000000000000004.
      expect(toDisplayRebateValue("percent_of_spend", 0.03)).toBe(3)
    })

    it("passes through dollar rebate types unchanged", () => {
      expect(toDisplayRebateValue("fixed_rebate", 500)).toBe(500)
      expect(toDisplayRebateValue("fixed_rebate_per_unit", 1.25)).toBe(1.25)
      expect(toDisplayRebateValue("per_procedure_rebate", 75)).toBe(75)
    })
  })

  describe("fromDisplayRebateValue (save)", () => {
    it("normalizes percent_of_spend percent → fraction", () => {
      expect(fromDisplayRebateValue("percent_of_spend", 3)).toBe(0.03)
      expect(fromDisplayRebateValue("percent_of_spend", 2.5)).toBe(0.025)
      expect(fromDisplayRebateValue("percent_of_spend", 0)).toBe(0)
    })

    it("round-trips cleanly with toDisplayRebateValue", () => {
      const saved = fromDisplayRebateValue("percent_of_spend", 3)
      expect(toDisplayRebateValue("percent_of_spend", saved)).toBe(3)
    })

    it("passes through dollar rebate types unchanged", () => {
      expect(fromDisplayRebateValue("fixed_rebate", 500)).toBe(500)
      expect(fromDisplayRebateValue("fixed_rebate_per_unit", 1.25)).toBe(1.25)
      expect(fromDisplayRebateValue("per_procedure_rebate", 75)).toBe(75)
    })
  })

  describe("normalizeAIRebateValue", () => {
    it("divides by 100 when AI returns whole percent (>1) for percent_of_spend", () => {
      expect(normalizeAIRebateValue("percent_of_spend", 3)).toBe(0.03)
      expect(normalizeAIRebateValue("percent_of_spend", 2.5)).toBe(0.025)
      expect(normalizeAIRebateValue("percent_of_spend", 6)).toBe(0.06)
    })

    it("passes through when AI already returns fraction (≤1)", () => {
      expect(normalizeAIRebateValue("percent_of_spend", 0.03)).toBe(0.03)
      expect(normalizeAIRebateValue("percent_of_spend", 1)).toBe(1)
      expect(normalizeAIRebateValue("percent_of_spend", 0)).toBe(0)
    })

    it("handles null/undefined gracefully", () => {
      expect(normalizeAIRebateValue("percent_of_spend", null)).toBe(0)
      expect(normalizeAIRebateValue("percent_of_spend", undefined)).toBe(0)
    })

    it("passes dollar rebate types through unchanged (values often >1)", () => {
      expect(normalizeAIRebateValue("fixed_rebate", 500)).toBe(500)
      expect(normalizeAIRebateValue("fixed_rebate_per_unit", 1.25)).toBe(1.25)
      expect(normalizeAIRebateValue("per_procedure_rebate", 75)).toBe(75)
    })
  })
})
