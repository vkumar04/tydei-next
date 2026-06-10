/**
 * 2026-06-09 (Charles "Performance period, rebate period — should match"):
 * display surfaces derive the two cadences from the contract's TERMS via
 * deriveContractCadence; the stored columns (set-once defaults
 * monthly/quarterly) are only the fallback for term-less contracts.
 */
import { describe, it, expect } from "vitest"
import { deriveContractCadence } from "@/lib/contracts/contract-cadence"

const STORED = { performancePeriod: "monthly", rebatePayPeriod: "quarterly" }

describe("deriveContractCadence", () => {
  it("terms win over stored defaults (the prod Mako shape)", () => {
    const out = deriveContractCadence(
      [{ evaluationPeriod: "semi_annual", paymentTiming: "semi_annual" }],
      STORED,
    )
    expect(out).toEqual({
      performancePeriod: "semi_annual",
      rebatePayPeriod: "semi_annual",
    })
  })

  it("modal cadence wins on multi-term contracts; ties break to the earliest term", () => {
    const out = deriveContractCadence(
      [
        { evaluationPeriod: "quarterly", paymentTiming: "quarterly" },
        { evaluationPeriod: "annual", paymentTiming: "annual" },
        { evaluationPeriod: "quarterly", paymentTiming: "annual" },
      ],
      STORED,
    )
    expect(out.performancePeriod).toBe("quarterly") // 2 vs 1
    expect(out.rebatePayPeriod).toBe("annual") // 2 vs 1
    // tie → earliest term
    const tie = deriveContractCadence(
      [
        { evaluationPeriod: "annual", paymentTiming: "monthly" },
        { evaluationPeriod: "quarterly", paymentTiming: "quarterly" },
      ],
      STORED,
    )
    expect(tie.performancePeriod).toBe("annual")
    expect(tie.rebatePayPeriod).toBe("monthly")
  })

  it("falls back to stored fields when there are no terms (or no cadences on them)", () => {
    expect(deriveContractCadence([], STORED)).toEqual({
      performancePeriod: "monthly",
      rebatePayPeriod: "quarterly",
    })
    expect(deriveContractCadence(null, STORED)).toEqual({
      performancePeriod: "monthly",
      rebatePayPeriod: "quarterly",
    })
    expect(
      deriveContractCadence(
        [{ evaluationPeriod: null, paymentTiming: null }],
        STORED,
      ),
    ).toEqual({ performancePeriod: "monthly", rebatePayPeriod: "quarterly" })
  })

  it("hard defaults when stored fields are also missing", () => {
    expect(deriveContractCadence([], {})).toEqual({
      performancePeriod: "monthly",
      rebatePayPeriod: "quarterly",
    })
  })
})
