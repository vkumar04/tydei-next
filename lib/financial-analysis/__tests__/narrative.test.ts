import { describe, expect, it } from "vitest"

import {
  buildFinancialAnalysisNarrative,
  type NarrativeInput,
} from "@/lib/financial-analysis/narrative"

/**
 * Baseline input — override only the fields each test cares about.
 * Capital cost is $1M so the verdict thresholds land on clean numbers:
 *   strong  >= $500k
 *   moderate >= $100k
 *   weak    >  $0
 */
function baseInput(overrides: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    contractName: "Stryker Capital Agreement",
    vendorName: "Stryker",
    capitalCost: 1_000_000,
    years: 5,
    npv: 200_000,
    irr: 0.15,
    discountRate: 0.08,
    totalRebate: 120_000,
    totalTaxSavings: 80_000,
    totalOpportunityCost: 10_000,
    riskAdjustedNPV: null,
    clauseRiskAdjustmentPercent: null,
    ...overrides,
  }
}

describe("buildFinancialAnalysisNarrative — verdict ladder", () => {
  it("strong: NPV >= 50% of capital cost", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ capitalCost: 1_000_000, npv: 600_000 }),
    )
    expect(n.verdict).toBe("strong")
  })

  it("moderate: NPV >= 10% but < 50% of capital cost", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ capitalCost: 1_000_000, npv: 150_000 }),
    )
    expect(n.verdict).toBe("moderate")
  })

  it("weak: NPV > 0 but < 10% of capital cost", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ capitalCost: 1_000_000, npv: 50_000 }),
    )
    expect(n.verdict).toBe("weak")
  })

  it("negative: NPV <= 0", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ capitalCost: 1_000_000, npv: -100_000 }),
    )
    expect(n.verdict).toBe("negative")
  })
})

describe("buildFinancialAnalysisNarrative — headlines", () => {
  it("strong headline includes contract name and formatted NPV", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({
        contractName: "Stryker Capital Agreement",
        capitalCost: 1_000_000,
        npv: 600_000,
      }),
    )
    expect(n.headline).toBe(
      "Stryker Capital Agreement shows strong ROI — NPV $600,000",
    )
  })

  it("moderate headline uses 'moderate win' language", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ contractName: "Contract A", npv: 150_000 }),
    )
    expect(n.headline).toBe("Contract A is a moderate win — NPV $150,000")
  })

  it("weak headline uses 'borderline' language", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ contractName: "Contract B", npv: 50_000 }),
    )
    expect(n.headline).toBe("Contract B is borderline — NPV $50,000")
  })

  it("negative headline flips sign and formats absolute value", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ contractName: "Contract C", npv: -100_000 }),
    )
    expect(n.headline).toBe("Contract C fails ROI — NPV -$100,000")
  })
})

describe("buildFinancialAnalysisNarrative — bullets", () => {
  it("NPV bullet is always present with years and discount percent", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ npv: 200_000, years: 5, discountRate: 0.08 }),
    )
    expect(n.bullets[0]).toBe(
      "Net present value: $200,000 over 5 years at 8.0% discount",
    )
  })

  it("IRR bullet present when irr is non-null", () => {
    const n = buildFinancialAnalysisNarrative(baseInput({ irr: 0.128 }))
    expect(n.bullets).toContain("Internal rate of return: 12.8%")
  })

  it("IRR bullet absent when irr is null", () => {
    const n = buildFinancialAnalysisNarrative(baseInput({ irr: null }))
    expect(n.bullets.some((b) => b.startsWith("Internal rate of return"))).toBe(
      false,
    )
  })

  it("rebate and tax-savings bullets always present", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ totalRebate: 120_000, totalTaxSavings: 80_000 }),
    )
    expect(n.bullets).toContain("Projected rebates: $120,000")
    expect(n.bullets).toContain("Tax savings from depreciation: $80,000")
  })

  it("opportunity-cost bullet appears only when total > 0", () => {
    const withCost = buildFinancialAnalysisNarrative(
      baseInput({ totalOpportunityCost: 25_000 }),
    )
    expect(withCost.bullets).toContain("Price-lock opportunity cost: $25,000")

    const withoutCost = buildFinancialAnalysisNarrative(
      baseInput({ totalOpportunityCost: 0 }),
    )
    expect(
      withoutCost.bullets.some((b) =>
        b.startsWith("Price-lock opportunity cost"),
      ),
    ).toBe(false)
  })

  it("risk-adjusted NPV bullet appears when both fields present (positive)", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ riskAdjustedNPV: 210_000, clauseRiskAdjustmentPercent: 5 }),
    )
    expect(n.bullets).toContain(
      "Contract-risk-adjusted NPV: $210,000 (+5.0%)",
    )
  })

  it("risk-adjusted NPV bullet appears with negative sign when percent negative", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ riskAdjustedNPV: 185_000, clauseRiskAdjustmentPercent: -7.5 }),
    )
    expect(n.bullets).toContain(
      "Contract-risk-adjusted NPV: $185,000 (-7.5%)",
    )
  })

  it("risk-adjusted NPV bullet absent when either field missing", () => {
    const n1 = buildFinancialAnalysisNarrative(
      baseInput({ riskAdjustedNPV: 200_000, clauseRiskAdjustmentPercent: null }),
    )
    expect(
      n1.bullets.some((b) => b.startsWith("Contract-risk-adjusted NPV")),
    ).toBe(false)
    const n2 = buildFinancialAnalysisNarrative(
      baseInput({ riskAdjustedNPV: null, clauseRiskAdjustmentPercent: -5 }),
    )
    expect(
      n2.bullets.some((b) => b.startsWith("Contract-risk-adjusted NPV")),
    ).toBe(false)
  })
})

describe("buildFinancialAnalysisNarrative — risks", () => {
  it("flags material price-lock cost vs NPV (> 20%)", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ npv: 100_000, totalOpportunityCost: 30_000 }),
    )
    expect(n.risks).toContain(
      "Price-lock cost is material vs NPV — reconsider shorter term",
    )
  })

  it("does not flag price-lock cost when below 20% of NPV", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ npv: 100_000, totalOpportunityCost: 10_000 }),
    )
    expect(
      n.risks.some((r) => r.startsWith("Price-lock cost is material")),
    ).toBe(false)
  })

  it("flags IRR below discount rate", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ irr: 0.05, discountRate: 0.08 }),
    )
    expect(n.risks).toContain(
      "IRR below discount rate — capital better deployed elsewhere",
    )
  })

  it("does not flag IRR when null (no real IRR in series)", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ irr: null, discountRate: 0.08 }),
    )
    expect(n.risks.some((r) => r.startsWith("IRR below"))).toBe(false)
  })

  it("flags clause risk when adjustment < -5%", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({
        riskAdjustedNPV: 180_000,
        clauseRiskAdjustmentPercent: -7.5,
      }),
    )
    expect(n.risks).toContain(
      "Clause risk subtracts >5% from NPV — prioritize contract renegotiation",
    )
  })

  it("does not flag clause risk at exactly -5%", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({
        riskAdjustedNPV: 190_000,
        clauseRiskAdjustmentPercent: -5,
      }),
    )
    expect(n.risks.some((r) => r.startsWith("Clause risk"))).toBe(false)
  })
})

describe("buildFinancialAnalysisNarrative — CTA", () => {
  it("CTA matches strong verdict", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ capitalCost: 1_000_000, npv: 600_000 }),
    )
    expect(n.cta).toBe(
      "Proceed to purchase. Negotiate term extension if available.",
    )
  })

  it("CTA matches moderate verdict", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ capitalCost: 1_000_000, npv: 150_000 }),
    )
    expect(n.cta).toBe("Proceed with vendor on typical terms.")
  })

  it("CTA matches weak verdict", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ capitalCost: 1_000_000, npv: 50_000 }),
    )
    expect(n.cta).toBe(
      "Pursue price-protection + term reduction before signing.",
    )
  })

  it("CTA matches negative verdict", () => {
    const n = buildFinancialAnalysisNarrative(
      baseInput({ capitalCost: 1_000_000, npv: -100_000 }),
    )
    expect(n.cta).toBe("Do not sign. Request revised proposal.")
  })
})
