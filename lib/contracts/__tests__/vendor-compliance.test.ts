/**
 * Unit tests for the canonical vendor "Spend Compliance" helper
 * (lib/contracts/vendor-compliance.ts). Pre-canonicalization three
 * vendor surfaces computed three different compliance values (caps of
 * 100 vs 120 vs an unrelated match-compliance average); these tests pin
 * the ONE definition: trailing-12mo spend ÷ Σ active-contract annual
 * targets, capped at VENDOR_COMPLIANCE_CAP_PCT, rounded to 0.1.
 */
import { describe, it, expect } from "vitest"
import {
  computeVendorCompliance,
  computeContractCompliance,
  VENDOR_COMPLIANCE_CAP_PCT,
} from "@/lib/contracts/vendor-compliance"

describe("computeContractCompliance", () => {
  it("returns spend/target as a percentage rounded to 0.1", () => {
    expect(
      computeContractCompliance({ spend12Mo: 500, annualTarget: 1000 }),
    ).toBe(50)
    expect(
      computeContractCompliance({ spend12Mo: 333, annualTarget: 1000 }),
    ).toBe(33.3)
  })

  it("caps at VENDOR_COMPLIANCE_CAP_PCT (120)", () => {
    expect(VENDOR_COMPLIANCE_CAP_PCT).toBe(120)
    expect(
      computeContractCompliance({ spend12Mo: 15000, annualTarget: 10000 }),
    ).toBe(120)
    // Exactly at the cap is not rounded past it.
    expect(
      computeContractCompliance({ spend12Mo: 12000, annualTarget: 10000 }),
    ).toBe(120)
  })

  it("returns null when there is no positive target", () => {
    expect(computeContractCompliance({ spend12Mo: 500, annualTarget: 0 })).toBe(
      null,
    )
    expect(
      computeContractCompliance({ spend12Mo: 500, annualTarget: -10 }),
    ).toBe(null)
    expect(
      computeContractCompliance({ spend12Mo: 500, annualTarget: NaN }),
    ).toBe(null)
  })
})

describe("computeVendorCompliance", () => {
  it("sums annual targets across active contracts", () => {
    expect(
      computeVendorCompliance({
        spend12Mo: 15000,
        annualTargets: [10000, 10000],
      }),
    ).toBe(75)
  })

  it("ignores non-positive / non-finite targets in the denominator", () => {
    expect(
      computeVendorCompliance({
        spend12Mo: 5000,
        annualTargets: [10000, 0, -500, NaN],
      }),
    ).toBe(50)
  })

  it("returns null when no contract carries a positive target", () => {
    expect(
      computeVendorCompliance({ spend12Mo: 5000, annualTargets: [] }),
    ).toBe(null)
    expect(
      computeVendorCompliance({ spend12Mo: 5000, annualTargets: [0, 0] }),
    ).toBe(null)
  })

  it("caps at VENDOR_COMPLIANCE_CAP_PCT (120)", () => {
    expect(
      computeVendorCompliance({ spend12Mo: 50000, annualTargets: [10000] }),
    ).toBe(120)
  })

  it("agrees with the per-contract variant for a single target (parity)", () => {
    for (const [spend, target] of [
      [500, 1000],
      [999, 1000],
      [12345, 10000],
      [0, 1000],
    ] as const) {
      expect(
        computeVendorCompliance({ spend12Mo: spend, annualTargets: [target] }),
      ).toBe(
        computeContractCompliance({ spend12Mo: spend, annualTarget: target }),
      )
    }
  })
})
