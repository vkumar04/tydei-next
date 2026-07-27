import { describe, it, expect } from "vitest"
import {
  seedAssumptions,
  seedRevenue,
} from "@/components/facility/analysis/dashboard/analysis-dashboard-client"
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

describe("seedRevenue — implied revenue must not revert to the rejected figure", () => {
  /**
   * Found 2026-07-27 during the e2e sweep; pre-existing since b3cde48a.
   *
   * Lighthouse Surgical Center, verbatim from the seeded DB: $1,446,360
   * trailing-12-month supply spend, 40 cases, $441,247 measured reimbursement
   * across 40 covered cases. Measured ≤ spend, so getFacilityAnalysisData sets
   * revenueIsImplied and substitutes the proxy spend ÷ 0.3 = $4,821,200.
   */
  const SPEND = 1_446_360
  const MEASURED = 441_247
  const CASES = 40
  const PROXY = SPEND / 0.3

  function impliedData(): FacilityAnalysisData {
    return emptyData({
      currentVendorSpend: SPEND,
      netRevenue: PROXY, // the loader already substituted the proxy
      measuredReimbursement: MEASURED,
      annualCaseVolume: CASES,
      reimbursementCoverage: { withRate: CASES, totalCases: CASES },
      revenueIsImplied: true,
      hasData: true,
    })
  }

  it("selects Manual mode when revenue is implied", () => {
    expect(seedRevenue(impliedData()).mode).toBe("manual")
  })

  it("reproduces the PROXY, not the measured figure the loader rejected", () => {
    const { avgReimbursementPerCase } = seedRevenue(impliedData())
    // Manual revenue is avgReimbursementPerCase × annualCaseVolume.
    const manualNetRevenue = avgReimbursementPerCase * CASES
    expect(Math.round(manualNetRevenue)).toBe(Math.round(PROXY))
    expect(Math.round(manualNetRevenue)).not.toBe(MEASURED)
  })

  it("never renders net revenue below the facility's own supply spend", () => {
    // That combination is a negative gross margin — the impossibility the
    // 2026-06-21 proxy exists to prevent, and what the page actually showed.
    const { avgReimbursementPerCase } = seedRevenue(impliedData())
    expect(avgReimbursementPerCase * CASES).toBeGreaterThan(SPEND)
  })

  it("still seeds from the real covered-case average when revenue is coherent", () => {
    // Guards against over-reach: only the IMPLIED branch changed.
    const coherent = emptyData({
      currentVendorSpend: 1_000_000,
      netRevenue: 5_000_000,
      measuredReimbursement: 5_000_000,
      annualCaseVolume: 100,
      reimbursementCoverage: { withRate: 50, totalCases: 100 },
      revenueIsImplied: false,
      hasData: true,
    })
    const { mode, avgReimbursementPerCase } = seedRevenue(coherent)
    expect(mode).toBe("actuals")
    expect(avgReimbursementPerCase).toBe(5_000_000 / 50)
  })
})

describe("no case data — spend must still produce coherent revenue", () => {
  /**
   * Charles 2026-07-27, "everything is 0".
   *
   * A facility with real COG spend but NO case-costing data rendered the whole
   * Contribution Margin table as 0 / $0 / $0 / 70%. Removing the old
   * `annualCaseVolume || 5_000` fabrication exposed it: manual revenue is
   * `perCase × cases`, so with zero cases it collapsed to $0 and discarded the
   * loader's spend-derived proxy. The fake case count had been the only thing
   * keeping that proxy alive.
   */
  const SPEND = 25_500_000
  const PROXY = SPEND / 0.3

  function noCases(): FacilityAnalysisData {
    return emptyData({
      currentVendorSpend: SPEND,
      netRevenue: PROXY,
      annualCaseVolume: 0,
      measuredReimbursement: 0,
      reimbursementCoverage: { withRate: 0, totalCases: 0 },
      revenueIsImplied: true,
      hasData: true,
    })
  }

  it("does not fabricate a case volume", () => {
    // The regression this whole change set exists to prevent.
    expect(seedAssumptions(noCases()).annualCaseVolume).toBe(0)
  })

  it("keeps the spend-derived proxy as the seeded net revenue", () => {
    // Revenue is derived from SPEND, not from cases, so it stays meaningful
    // even with no case-costing data. $0 revenue against $25.5M of supply spend
    // is incoherent, not honest.
    expect(seedAssumptions(noCases()).netRevenue).toBe(PROXY)
    expect(seedAssumptions(noCases()).netRevenue).toBeGreaterThan(SPEND)
  })

  it("yields a zero per-case seed, which is why the caller must not multiply by it", () => {
    // seedRevenue can only return 0 here — there are no cases to divide by.
    // AnalysisDashboardClient therefore falls back to assumptions.netRevenue
    // instead of computing perCase × 0.
    const { mode, avgReimbursementPerCase } = seedRevenue(noCases())
    expect(mode).toBe("manual")
    expect(avgReimbursementPerCase).toBe(0)
    expect(avgReimbursementPerCase * 0).toBe(0)
  })
})
