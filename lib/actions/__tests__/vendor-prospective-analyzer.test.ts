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

  it("top-level internalUnitCost wins over benchmarks and suppresses the fallback warning", () => {
    // No benchmark cost at all → would normally warn + assume 55% margin.
    const result = analyzeVendorProspective(
      baseInput({
        benchmarks: [{ vendorItemNo: "X", nationalAvgPrice: 130 }],
        internalUnitCost: 60,
      }),
    )
    expect(
      result.warnings.some((w) =>
        w.toLowerCase().includes("no internal unit cost"),
      ),
    ).toBe(false)
    // $60 cost on the $100 Floor (× 1000 vol, 5% rebate) → COGS = $60k.
    const floor = result.scenarioResults.find((s) => s.scenarioName === "Floor")
    expect(floor?.estimatedCOGS).toBe(60_000)
  })

  it("warns and falls back to 55% gross margin when no internal unit cost is provided", () => {
    const result = analyzeVendorProspective(
      baseInput({ benchmarks: [{ vendorItemNo: "X", nationalAvgPrice: 130 }] }),
    )
    expect(
      result.warnings.some((w) =>
        w.toLowerCase().includes("no internal unit cost"),
      ),
    ).toBe(true)
    // 45% COGS of the $100 Floor unit price × 1000 vol = $45k.
    const floor = result.scenarioResults.find((s) => s.scenarioName === "Floor")
    expect(floor?.estimatedCOGS).toBe(45_000)
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

  it("uses facilityCurrentVendorRevenue directly for revenue-at-risk and penetration (audit H3)", () => {
    // Backfill semantics: the action knows the vendor's own sales
    // ($90k) and derived facility total = 90k / 0.2 = 450k. The
    // analyzer must NOT re-derive current revenue as spend × share —
    // it takes the known vendor revenue directly.
    const result = analyzeVendorProspective(
      baseInput({
        facilityEstimatedAnnualSpend: 450_000,
        facilityCurrentVendorRevenue: 90_000,
        facilityCurrentVendorShare: 0.2,
        targetVendorShare: 0.5,
      }),
    )
    expect(result.revenueAtRisk).toBe(90_000)
    expect(result.penetrationAnalysis.currentAnnualRevenue).toBe(90_000)
    expect(result.penetrationAnalysis.targetAnnualRevenue).toBe(225_000) // 450k * 50%
    expect(result.penetrationAnalysis.incrementalRevenueOpportunity).toBe(
      135_000, // 225k - 90k
    )
  })

  it("falls back to spend × share when no explicit vendor revenue is supplied", () => {
    const result = analyzeVendorProspective(baseInput())
    expect(result.revenueAtRisk).toBe(100_000) // 500k * 20%
    expect(result.penetrationAnalysis.currentAnnualRevenue).toBe(100_000)
  })

  it("keeps a vendor-revenue-only input coherent when no share is known", () => {
    // No-share backfill: action passes vendor spend as BOTH the spend
    // proxy and the revenue (plus a warning at the action layer).
    const result = analyzeVendorProspective(
      baseInput({
        facilityEstimatedAnnualSpend: 90_000,
        facilityCurrentVendorRevenue: 90_000,
        facilityCurrentVendorShare: undefined,
        targetVendorShare: undefined,
      }),
    )
    expect(result.revenueAtRisk).toBe(90_000)
    // Default target share is 50% of the (proxy) spend = 45k < current
    // revenue → incremental opportunity clamps to 0 rather than going
    // negative.
    expect(
      result.penetrationAnalysis.incrementalRevenueOpportunity,
    ).toBe(0)
  })

  it("does NOT fall back to nationalAvgPrice for the benchmark list discount (audit M8)", () => {
    const result = analyzeVendorProspective(
      baseInput({
        benchmarks: [
          // National-average row only — arbitrary first-row fallback
          // used to leak in as a fake "internal list price".
          { vendorItemNo: "RANDOM-1", nationalAvgPrice: 999 },
        ],
      }),
    )
    for (const s of result.scenarioResults) {
      expect(s.discountFromBenchmarkList).toBeNull()
    }
  })

  it("still computes discountFromBenchmarkList from a real internal list price", () => {
    const result = analyzeVendorProspective(baseInput())
    const floor = result.scenarioResults.find(
      (s) => s.scenarioName === "Floor",
    )!
    // internalListPrice 150, unitPrice 100 → 33.3% discount.
    expect(floor.discountFromBenchmarkList).toBeCloseTo(1 / 3, 5)
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
