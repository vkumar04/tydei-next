import { describe, it, expect } from "vitest"
import { seedAssumptions } from "@/components/facility/analysis/dashboard/analysis-dashboard-client"
import { DEFAULT_FACILITY_ASSUMPTIONS } from "@/lib/financial-analysis/prospective-impact-model"
import type { FacilityAnalysisData } from "@/lib/actions/facility-analysis-data"

/**
 * Charles 2026-07-27: "With no data in COG this is still coming up."
 *
 * The Current State page presented $12.5M vendor spend / $1.0M EBITDA / $11.9M
 * DCF for a facility with zero COG rows, because seedAssumptions used `||`
 * fallbacks and `0 || 12_500_000` silently substituted the demo constant. A
 * zero is real data, not a missing value.
 */
function emptyData(over: Partial<FacilityAnalysisData> = {}): FacilityAnalysisData {
  return {
    currentVendorSpend: 0,
    netRevenue: 0,
    annualCaseVolume: 0,
    measuredReimbursement: 0,
    revenueIsImplied: false,
    reimbursementCoverage: { withRate: 0, totalCases: 0 },
    categories: [],
    vendors: [],
    topVendorConcentrationPct: 0,
    hasData: false,
    ...over,
  } as FacilityAnalysisData
}

describe("seedAssumptions — no COG data", () => {
  it("never substitutes the demo constants for real zeros", () => {
    const seeded = seedAssumptions(emptyData())
    expect(seeded.currentVendorSpend).toBe(0)
    expect(seeded.annualCaseVolume).toBe(0)
    expect(seeded.netRevenue).toBe(0)
    // The specific numbers Charles saw on screen.
    expect(seeded.currentVendorSpend).not.toBe(
      DEFAULT_FACILITY_ASSUMPTIONS.currentVendorSpend,
    )
    expect(seeded.annualCaseVolume).not.toBe(
      DEFAULT_FACILITY_ASSUMPTIONS.annualCaseVolume,
    )
  })

  it("still seeds the unknowable modeling knobs from defaults", () => {
    // Margin %, discount rate and growth are modeling choices, not facility
    // data — those SHOULD keep coming from the defaults.
    const seeded = seedAssumptions(emptyData())
    expect(seeded.ebitdaMarginPct).toBe(DEFAULT_FACILITY_ASSUMPTIONS.ebitdaMarginPct)
    expect(seeded.discountRatePct).toBe(DEFAULT_FACILITY_ASSUMPTIONS.discountRatePct)
  })

  it("returns the illustrative model only on an explicit sample opt-in", () => {
    const sample = seedAssumptions(emptyData(), true)
    expect(sample).toEqual(DEFAULT_FACILITY_ASSUMPTIONS)
  })

  it("passes real facility figures through untouched", () => {
    const seeded = seedAssumptions(
      emptyData({
        currentVendorSpend: 8_100_000,
        netRevenue: 3_500_000,
        annualCaseVolume: 4_200,
        hasData: true,
      }),
    )
    expect(seeded.currentVendorSpend).toBe(8_100_000)
    expect(seeded.netRevenue).toBe(3_500_000)
    expect(seeded.annualCaseVolume).toBe(4_200)
  })

  it("does not fabricate cases on the uploaded-file path either", () => {
    // uploaded-spend-to-analysis-data.ts returns annualCaseVolume: 0, and the
    // subtitle claims "Modeled from uploaded file X" — a stronger provenance
    // claim than the no-data case, so a fabricated 5,000 cases was worse here.
    const uploaded = seedAssumptions(
      emptyData({ currentVendorSpend: 2_400_000, hasData: true }),
    )
    expect(uploaded.annualCaseVolume).toBe(0)
  })
})
