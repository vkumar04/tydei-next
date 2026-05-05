/**
 * Smoke tests for the canonical vendor prospective analyzer.
 * Pure-engine tests — no Prisma, no IO.
 */

import { describe, expect, it } from "vitest"
import {
  analyzeVendorProspective,
  type VendorProspectiveInput,
} from "@/lib/prospective-analysis/vendor-prospective-analyzer"

function baseInput(
  overrides?: Partial<VendorProspectiveInput>,
): VendorProspectiveInput {
  return {
    facilityId: "fac1",
    facilityName: "Lighthouse Surgical Center",
    facilityType: "ASC",
    contractVariant: "USAGE_SPEND",
    pricingScenarios: [
      {
        scenarioName: "Floor",
        unitPrice: 100,
        estimatedAnnualVolume: 1000,
        rebatePercent: 5,
      },
      {
        scenarioName: "Target",
        unitPrice: 120,
        estimatedAnnualVolume: 1000,
        rebatePercent: 3,
      },
      {
        scenarioName: "Ceiling",
        unitPrice: 140,
        estimatedAnnualVolume: 1000,
        rebatePercent: 0,
      },
    ],
    benchmarks: [
      {
        vendorItemNo: "ABC123",
        internalUnitCost: 60, // 50% gross margin at $120, ~37% at $100
        internalListPrice: 150,
      },
    ],
    facilityEstimatedAnnualSpend: 500_000,
    facilityCurrentVendorShare: 0.2,
    targetVendorShare: 0.5,
    targetGrossMarginPercent: 0.4,
    minimumAcceptableGrossMarginPercent: 0.25,
    ...overrides,
  }
}

describe("analyzeVendorProspective", () => {
  it("happy path: picks the highest-margin scenario above the floor", () => {
    const result = analyzeVendorProspective(baseInput())
    expect(result.scenarioResults).toHaveLength(3)
    expect(result.recommendedScenario).not.toBeNull()
    // Ceiling pays no rebate and has the highest unit price → highest margin.
    expect(result.recommendedScenario?.scenarioName).toBe("Ceiling")
    // All three should pass the floor here.
    for (const s of result.scenarioResults) {
      expect(s.meetsFloorMargin).toBe(true)
    }
    // Penetration math
    expect(result.revenueAtRisk).toBe(100_000) // 500k * 20%
    expect(result.penetrationAnalysis.incrementalRevenueOpportunity).toBe(
      150_000,
    )
    // No tier config → tier-optimization fallback message
    expect(result.tierOptimization.recommendation).toContain("No tiered")
  })

  it("emits a warning when no scenario meets the floor", () => {
    const result = analyzeVendorProspective(
      baseInput({
        // unit cost > unit price → negative margin everywhere
        benchmarks: [{ vendorItemNo: "X", internalUnitCost: 200 }],
        minimumAcceptableGrossMarginPercent: 0.25,
      }),
    )
    expect(result.recommendedScenario).toBeNull()
    expect(
      result.warnings.some((w) =>
        w.toLowerCase().includes("no scenario meets"),
      ),
    ).toBe(true)
  })

  it("computes capital payback when variant is CAPITAL_TIE_IN", () => {
    const result = analyzeVendorProspective(
      baseInput({
        contractVariant: "CAPITAL_TIE_IN",
        capitalDetails: {
          equipmentCost: 200_000,
          annualMaintenanceCost: 5_000,
          termMonths: 60,
          interestRate: 0.05,
          discountRate: 0.1,
        },
      }),
    )
    expect(result.capitalAnalysis).not.toBeNull()
    expect(result.capitalAnalysis!.equipmentCost).toBe(200_000)
    expect(result.capitalAnalysis!.paybackYears).toBeGreaterThan(0)
    expect(
      result.capitalAnalysis!.facilityBreakEvenPaymentPerPeriod,
    ).toBeGreaterThan(0)
  })
})
