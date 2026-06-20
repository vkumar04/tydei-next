import { describe, it, expect } from "vitest"
import {
  matchOrCreateVendorId,
  deriveRebatePayPeriod,
} from "@/components/contracts/new-contract-helpers"

describe("deriveRebatePayPeriod", () => {
  it("prefers the explicit contract-level rebatePayPeriod", () => {
    expect(
      deriveRebatePayPeriod("quarterly", [{ evaluationPeriod: "annual" }]),
    ).toBe("quarterly")
  })

  it("falls back to a term's evaluationPeriod when the top-level field is null (Charles 2026-06-20)", () => {
    // The model captured the per-term Evaluation Period as "annual" but left
    // the contract-level field null — the form must NOT default to monthly.
    expect(
      deriveRebatePayPeriod(null, [
        { evaluationPeriod: "annual", paymentTiming: "quarterly" },
      ]),
    ).toBe("annual")
  })

  it("falls back to paymentTiming when no evaluationPeriod is present", () => {
    expect(deriveRebatePayPeriod(undefined, [{ paymentTiming: "semi_annual" }])).toBe(
      "semi_annual",
    )
  })

  it("returns undefined when nothing is available (form keeps its value)", () => {
    expect(deriveRebatePayPeriod(null, undefined)).toBeUndefined()
    expect(deriveRebatePayPeriod(null, [{}])).toBeUndefined()
  })
})

describe("matchOrCreateVendorId", () => {
  it("matches by case-insensitive prefix when name fragment is provided", () => {
    const vendors = [
      { id: "v1", name: "Stryker Corporation", displayName: null },
      { id: "v2", name: "Medtronic Inc.", displayName: "Medtronic" },
    ]
    expect(matchOrCreateVendorId("Stryker", vendors)).toBe("v1")
    expect(matchOrCreateVendorId("medtronic", vendors)).toBe("v2")
    expect(matchOrCreateVendorId("Medtronic Inc.", vendors)).toBe("v2")
  })

  it("returns null when vendorName is empty", () => {
    expect(matchOrCreateVendorId("", [{ id: "v1", name: "x", displayName: null }])).toBeNull()
    expect(matchOrCreateVendorId("   ", [])).toBeNull()
  })

  it("returns null (caller will create) when no vendor matches", () => {
    expect(matchOrCreateVendorId("BrandNew Corp", [{ id: "v1", name: "Stryker", displayName: null }])).toBeNull()
  })
})
