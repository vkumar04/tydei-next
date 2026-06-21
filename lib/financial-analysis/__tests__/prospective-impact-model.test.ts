import { describe, it, expect } from "vitest"
import {
  computeFacilityProspectiveModel,
  discountedCashFlow,
  DEFAULT_FACILITY_ASSUMPTIONS,
  type FacilityModelAssumptions,
} from "../prospective-impact-model"

// Screenshot baseline: $41.7M net revenue, 30% EBITDA margin, 80% DCF,
// 10% discount, 3% growth, 5 yrs; $625,879 negotiated annual savings.
const SCREENSHOT: FacilityModelAssumptions = {
  netRevenue: 41_700_000,
  currentVendorSpend: 12_500_000,
  annualCaseVolume: 5,
  supplyCostPctOfRevenue: 0.3,
  ebitdaMarginPct: 0.3,
  dcfPctOfEbitda: 0.8,
  discountRatePct: 0.1,
  cashFlowGrowthPct: 0.03,
  dcfProjectionYears: 5,
}
const SAVINGS = 625_879

describe("computeFacilityProspectiveModel — current state (screenshot parity)", () => {
  const { current } = computeFacilityProspectiveModel(SCREENSHOT, SAVINGS)

  it("EBITDA = netRevenue × margin ≈ $12.5M", () => {
    expect(current.ebitda).toBeCloseTo(12_510_000, 0)
  })

  it("distributable cash flow/yr = EBITDA × 80% = $10.0M", () => {
    expect(current.distributableCashFlowPerYear).toBeCloseTo(10_008_000, 0)
  })

  it("DCF (growing annuity PV) ≈ $40.1M", () => {
    // Within $0.5M of the rendered $40.1M.
    expect(current.dcf).toBeGreaterThan(39_600_000)
    expect(current.dcf).toBeLessThan(40_600_000)
  })
})

describe("computeFacilityProspectiveModel — prospective impact (screenshot parity)", () => {
  const { impact } = computeFacilityProspectiveModel(SCREENSHOT, SAVINGS)

  it("ΔEBITDA = savings (+$625.9K)", () => {
    expect(impact.impactToEbitda).toBeCloseTo(625_879, 0)
  })

  it("ΔMargin = +1.50 pts", () => {
    expect(impact.impactToMarginPoints).toBeCloseTo(1.5, 1)
  })

  it("ΔDistributable cash flow = +$500.7K", () => {
    expect(impact.impactToDistributableCashFlow).toBeCloseTo(500_703, 0)
  })

  it("EV impact = +$6.3M / $7.5M / $8.8M at 10×/12×/14×", () => {
    const [c, e, a] = impact.enterpriseValue
    expect(c!.incrementalEv).toBeCloseTo(6_258_790, 0)
    expect(e!.incrementalEv).toBeCloseTo(7_510_548, 0)
    expect(a!.incrementalEv).toBeCloseTo(8_762_306, 0)
  })

  it("future EV = current EV + incremental", () => {
    for (const ev of impact.enterpriseValue) {
      expect(ev.futureEv).toBeCloseTo(ev.currentEv + ev.incrementalEv, 2)
    }
  })
})

describe("edge cases", () => {
  it("zero case volume → $/case is 0 (no divide-by-zero)", () => {
    const { impact } = computeFacilityProspectiveModel(
      { ...SCREENSHOT, annualCaseVolume: 0 },
      SAVINGS,
    )
    expect(impact.impactPerCase).toBe(0)
  })

  it("$/case spreads savings across cases", () => {
    const { impact } = computeFacilityProspectiveModel(
      { ...SCREENSHOT, annualCaseVolume: 1000 },
      1_000_000,
    )
    expect(impact.impactPerCase).toBeCloseTo(1000, 5)
  })

  it("negative savings clamp to 0", () => {
    const { impact } = computeFacilityProspectiveModel(SCREENSHOT, -5000)
    expect(impact.annualSupplySavings).toBe(0)
    expect(impact.impactToEbitda).toBe(0)
  })

  it("DEFAULT_FACILITY_ASSUMPTIONS produce the screenshot EBITDA", () => {
    const { current } = computeFacilityProspectiveModel(
      DEFAULT_FACILITY_ASSUMPTIONS,
      0,
    )
    expect(current.ebitda).toBeCloseTo(12_510_000, 0)
  })
})

describe("discountedCashFlow", () => {
  it("0 years → 0", () => {
    expect(discountedCashFlow(1000, 0, 0.1, 0.03)).toBe(0)
  })

  it("no growth, single year = base / (1+r)", () => {
    expect(discountedCashFlow(1100, 1, 0.1, 0)).toBeCloseTo(1000, 5)
  })

  it("handles r == g without NaN", () => {
    const pv = discountedCashFlow(1000, 5, 0.05, 0.05)
    expect(Number.isFinite(pv)).toBe(true)
    expect(pv).toBeGreaterThan(0)
  })
})

import { computeDealScenarioSavings } from "../prospective-impact-model"

describe("computeDealScenarioSavings (facility deal-scenario lens)", () => {
  it("savings = spend × conversion × (1+growth) × price-cut", () => {
    expect(
      computeDealScenarioSavings({
        currentVendorSpend: 10_000_000,
        priceChangePct: -0.05, // 5% cut
        conversionPct: 0.5,
        volumeGrowthPct: 0,
      }),
    ).toBeCloseTo(250_000, 0) // 10M × 0.5 × 0.05
  })

  it("volume growth scales the converted base", () => {
    expect(
      computeDealScenarioSavings({
        currentVendorSpend: 10_000_000,
        priceChangePct: -0.1,
        conversionPct: 1,
        volumeGrowthPct: 0.2,
      }),
    ).toBeCloseTo(1_200_000, 0) // 10M × 1 × 1.2 × 0.1
  })

  it("a price increase (or no cut) yields zero savings", () => {
    expect(
      computeDealScenarioSavings({
        currentVendorSpend: 10_000_000,
        priceChangePct: 0.05,
        conversionPct: 1,
        volumeGrowthPct: 0,
      }),
    ).toBe(0)
  })

  it("conversion clamps to [0,1]", () => {
    expect(
      computeDealScenarioSavings({
        currentVendorSpend: 1_000_000,
        priceChangePct: -0.1,
        conversionPct: 2,
        volumeGrowthPct: 0,
      }),
    ).toBeCloseTo(100_000, 0) // clamped to conversion=1
  })
})
