/**
 * Penetration / revenue-at-risk math in analyzeVendorProspective
 * (Charles 2026-06-30, Deal Scorer Penetration card).
 *
 * The observed nonsense: usage-file-derived current revenue ($15.0M)
 * next to "current share 0%", a target revenue ($699K) far BELOW
 * current revenue (because the facility-spend estimate was backfilled
 * from thin COG history), incremental $0, and "revenue at risk" = the
 * entire book. The engine now (1) floors the facility spend at the
 * directly-known current revenue, (2) derives the current share from
 * revenue ÷ spend when none was entered, and (3) warns when the target
 * models a revenue LOSS instead of silently rendering it.
 */

import { describe, expect, it } from "vitest"
import {
  analyzeVendorProspective,
  type VendorProspectiveInput,
} from "../vendor-prospective-analyzer"

function baseInput(
  overrides: Partial<VendorProspectiveInput> = {},
): VendorProspectiveInput {
  return {
    facilityId: "f1",
    facilityName: "Lighthouse Surgical Center",
    facilityType: "ASC",
    contractVariant: "USAGE_SPEND",
    pricingScenarios: [
      {
        scenarioName: "Target",
        unitPrice: 100,
        estimatedAnnualVolume: 1000,
        rebatePercent: 2,
      },
    ],
    benchmarks: [],
    internalUnitCost: 50,
    facilityEstimatedAnnualSpend: 1_000_000,
    targetGrossMarginPercent: 0.4,
    minimumAcceptableGrossMarginPercent: 0.25,
    ...overrides,
  }
}

describe("penetration — consistent inputs keep the original behavior", () => {
  it("uses spend × share when no direct revenue is known", () => {
    const r = analyzeVendorProspective(
      baseInput({
        facilityCurrentVendorShare: 0.3,
        targetVendorShare: 0.6,
      }),
    )
    expect(r.penetrationAnalysis).toMatchObject({
      currentShare: 0.3,
      targetShare: 0.6,
      currentAnnualRevenue: 300_000,
      targetAnnualRevenue: 600_000,
      incrementalRevenueOpportunity: 300_000,
    })
    expect(r.revenueAtRisk).toBe(300_000)
  })

  it("prefers the directly-known current revenue over spend × share", () => {
    const r = analyzeVendorProspective(
      baseInput({
        facilityCurrentVendorRevenue: 400_000,
        facilityCurrentVendorShare: 0.3,
        targetVendorShare: 0.6,
      }),
    )
    expect(r.penetrationAnalysis.currentAnnualRevenue).toBe(400_000)
    expect(r.revenueAtRisk).toBe(400_000)
    expect(r.penetrationAnalysis.targetAnnualRevenue).toBe(600_000)
    expect(r.penetrationAnalysis.incrementalRevenueOpportunity).toBe(200_000)
  })

  it("no share, no revenue → zero current revenue and zero at risk (not the whole spend)", () => {
    const r = analyzeVendorProspective(baseInput({ targetVendorShare: 0.5 }))
    expect(r.penetrationAnalysis.currentAnnualRevenue).toBe(0)
    expect(r.revenueAtRisk).toBe(0)
    expect(r.penetrationAnalysis.targetAnnualRevenue).toBe(500_000)
  })
})

describe("penetration — the Charles case: spend estimate below known revenue", () => {
  // Usage-file revenue $15.0M, backfilled spend estimate $777K, target
  // share 90%, no current share entered.
  const charles = () =>
    baseInput({
      facilityCurrentVendorRevenue: 15_045_209,
      facilityEstimatedAnnualSpend: 777_251,
      targetVendorShare: 0.9,
    })

  it("floors the facility spend at the known current revenue and warns", () => {
    const r = analyzeVendorProspective(charles())
    // Target revenue is now 90% of the FLOORED spend — never $699K
    // against a $15M current book.
    expect(r.penetrationAnalysis.targetAnnualRevenue).toBeCloseTo(
      15_045_209 * 0.9,
      0,
    )
    expect(
      r.warnings.some((w) => w.includes("spend floor")),
    ).toBe(true)
  })

  it("derives the current share instead of showing 0% next to a real revenue", () => {
    const r = analyzeVendorProspective(charles())
    // Revenue equals the floored spend → as far as we can see, the
    // vendor already holds 100% of the visible spend.
    expect(r.penetrationAnalysis.currentShare).toBe(1)
    expect(r.penetrationAnalysis.currentAnnualRevenue).toBe(15_045_209)
  })

  it("warns when the target share models a revenue LOSS (target < current)", () => {
    const r = analyzeVendorProspective(charles())
    // 90% of the floored spend < 100% current → explicit warning, and
    // incremental clamps at 0 rather than going negative.
    expect(r.penetrationAnalysis.incrementalRevenueOpportunity).toBe(0)
    expect(
      r.warnings.some((w) => w.includes("LESS revenue than you earn today")),
    ).toBe(true)
  })

  it("an entered current share always wins over the derivation", () => {
    const r = analyzeVendorProspective(
      baseInput({
        facilityCurrentVendorRevenue: 500_000,
        facilityEstimatedAnnualSpend: 2_000_000,
        facilityCurrentVendorShare: 0.4,
        targetVendorShare: 0.6,
      }),
    )
    expect(r.penetrationAnalysis.currentShare).toBe(0.4)
    expect(r.penetrationAnalysis.currentAnnualRevenue).toBe(500_000)
    expect(r.penetrationAnalysis.targetAnnualRevenue).toBe(1_200_000)
  })

  it("derives a partial share when revenue is a fraction of a sane spend estimate", () => {
    const r = analyzeVendorProspective(
      baseInput({
        facilityCurrentVendorRevenue: 250_000,
        facilityEstimatedAnnualSpend: 1_000_000,
        targetVendorShare: 0.5,
      }),
    )
    expect(r.penetrationAnalysis.currentShare).toBe(0.25)
    expect(r.penetrationAnalysis.targetAnnualRevenue).toBe(500_000)
    expect(r.penetrationAnalysis.incrementalRevenueOpportunity).toBe(250_000)
    // No inconsistency → no floor warning.
    expect(r.warnings.some((w) => w.includes("spend floor"))).toBe(false)
  })
})

describe("penetration — the Charles 2026-07-27 case: an entered 0% share", () => {
  // Reproduces the "Penetration & revenue at risk" card from the bug report
  // verbatim: unit price $3,200 × 700 units = $2,240,000 of basket spend,
  // 90% market-share commitment, and a current share the vendor entered as 0.
  //
  // Pre-fix the card read:
  //   Current share 0.0% | Current revenue $2,240,000
  //   Target revenue $2,016,000 | Incremental $0 | At risk $2,240,000
  // Charles: "current share is 0 / there is nothing at risk it is all growth."
  function zeroShareInput() {
    return baseInput({
      facilityCurrentVendorShare: 0,
      facilityCurrentVendorRevenue: 2_240_000,
      facilityEstimatedAnnualSpend: 0,
      targetVendorShare: 0.9,
    })
  }

  it("reports no current revenue and nothing at risk", () => {
    const r = analyzeVendorProspective(zeroShareInput())
    expect(r.penetrationAnalysis.currentShare).toBe(0)
    expect(r.penetrationAnalysis.currentAnnualRevenue).toBe(0)
    expect(r.revenueAtRisk).toBe(0)
  })

  it("treats the whole target as incremental growth", () => {
    const r = analyzeVendorProspective(zeroShareInput())
    // The supplied figure is the addressable basket, so it floors the
    // denominator: $2,240,000 × 90% = $2,016,000, all of it new business.
    expect(r.penetrationAnalysis.targetAnnualRevenue).toBe(2_016_000)
    expect(r.penetrationAnalysis.incrementalRevenueOpportunity).toBe(2_016_000)
  })

  it("emits neither the spend-floor nor the revenue-loss warning", () => {
    const r = analyzeVendorProspective(zeroShareInput())
    expect(r.warnings.some((w) => w.includes("spend floor"))).toBe(false)
    expect(r.warnings.some((w) => w.includes("LESS revenue"))).toBe(false)
  })

  it("still lets a real non-zero share keep the known-revenue behavior", () => {
    // Guards the fix against over-reach: only an entered ZERO reclassifies.
    const r = analyzeVendorProspective(
      baseInput({
        facilityCurrentVendorShare: 0.4,
        facilityCurrentVendorRevenue: 500_000,
        facilityEstimatedAnnualSpend: 2_000_000,
        targetVendorShare: 0.6,
      }),
    )
    expect(r.penetrationAnalysis.currentAnnualRevenue).toBe(500_000)
    expect(r.revenueAtRisk).toBe(500_000)
  })
})
