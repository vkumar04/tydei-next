import { describe, it, expect } from "vitest"
import {
  computeFacilityProspectiveModel,
  DEFAULT_FACILITY_ASSUMPTIONS,
} from "@/lib/financial-analysis/prospective-impact-model"
import {
  buildNarrative,
  buildAnalysisCsv,
  buildAnalysisPdfPayload,
} from "@/components/facility/analysis/dashboard/export-analysis"
import {
  facilityCurrentStateRows,
  buildOpportunityPdfPayload,
} from "@/app/vendor/prospective/sections/export-opportunity"
import {
  buildDashboardModel,
  DEFAULT_AI_INPUTS,
  type DashboardModel,
} from "@/components/facility/analysis/dashboard/model"
import type { FacilityCurrentStateSnapshot } from "@/components/vendor/prospective/facility-current-state"

// The exports must "tell the story of the data" (Vick 2026-06-22): a narrative
// that walks spend → revenue → EBITDA → DCF (explicit + terminal) → impact, and
// a Facility Current State block that travels with the Opportunity Engine export.
describe("buildNarrative (Analysis export story)", () => {
  const prospective = computeFacilityProspectiveModel(
    DEFAULT_FACILITY_ASSUMPTIONS,
    625_879,
  )
  // buildNarrative only reads model.prospective.
  const model = { prospective } as unknown as DashboardModel
  const text = buildNarrative(model, DEFAULT_FACILITY_ASSUMPTIONS)

  it("walks the full chain spend → revenue → EBITDA → DCF", () => {
    expect(text).toMatch(/net revenue/i)
    expect(text).toMatch(/supply spend/i)
    expect(text).toMatch(/EBITDA/)
    expect(text).toMatch(/enterprise value \(DCF\)/i)
  })

  it("splits the DCF into explicit window + terminal value", () => {
    expect(text).toMatch(/explicit/i)
    expect(text).toMatch(/terminal value/i)
  })

  it("describes the negotiated-saving lift when savings > 0", () => {
    expect(text).toMatch(/supply saving/i)
    expect(text).toMatch(/margin pts/i)
    expect(text).toMatch(/enterprise value at a \d+x exit/i)
  })

  it("prompts to model a saving when there is none", () => {
    const noSaving = {
      prospective: computeFacilityProspectiveModel(DEFAULT_FACILITY_ASSUMPTIONS, 0),
    } as unknown as DashboardModel
    expect(buildNarrative(noSaving, DEFAULT_FACILITY_ASSUMPTIONS)).toMatch(
      /Model a negotiated supply saving/i,
    )
  })
})

// Every figure on the dashboard must appear in BOTH exports (CLAUDE.md "Both
// exports carry the full picture"). The CSV must enumerate every dashboard
// section — including the AI Prospective Impact Engine layer and the
// Conversion Targets card, which were audited as missing (2026-07-02).
describe("buildAnalysisCsv (export completeness)", () => {
  const model = buildDashboardModel(
    DEFAULT_FACILITY_ASSUMPTIONS,
    625_879,
    DEFAULT_AI_INPUTS,
  )
  const csv = buildAnalysisCsv(model, DEFAULT_FACILITY_ASSUMPTIONS)

  it("includes every core dashboard section header", () => {
    for (const header of [
      "Current State Analysis",
      "Summary",
      "Financial Assumptions",
      "Category Spend & ASP",
      "Vendor Market Share",
      "Contribution Margin by Procedure",
      "Individual Impact by Category",
      "Enterprise Value Impact",
    ]) {
      expect(csv).toContain(header)
    }
  })

  it("includes the AI Prospective Impact Engine layer", () => {
    for (const header of [
      "AI Prospective Impact Engine",
      "Contract Opportunity Score",
      "EBITDA to EV Waterfall",
      "Managed Care Reimbursement",
      "Payback Analysis",
    ]) {
      expect(csv).toContain(header)
    }
    // Score components + waterfall steps + payback scenarios actually render.
    expect(csv).toMatch(/EBITDA Impact/)
    expect(csv).toMatch(/Future EBITDA/)
    expect(csv).toMatch(/conservative/)
    expect(csv).toMatch(/% of Medicare/)
  })

  it("includes the Conversion Targets card (headline + per-target rows)", () => {
    expect(csv).toContain("Conversion Targets")
    expect(csv).toContain("Above Benchmark ASP")
    // The seed mix always yields targets + a Pareto-knee headline.
    expect(csv).toMatch(/Converting \d+% of .+ volume yields/)
    expect(csv).toMatch(/Behavior Change/)
  })
})

describe("facilityCurrentStateRows (Opportunity Engine export)", () => {
  const snapshot: FacilityCurrentStateSnapshot = {
    facilityName: "Lighthouse Surgical Center",
    currentVendorSpend: 23_700_000,
    netRevenue: 9_900_000,
    ebitda: 2_970_000,
    ebitdaMarginPct: 0.3,
    dcf: 34_000_000,
    dcfExplicit: 9_500_000,
    dcfTerminalValue: 24_400_000,
    annualCaseVolume: 674,
    revenueMode: "manual",
    avgReimbursementPerCase: 14_700,
    dcfPctOfEbitda: 0.8,
    discountRatePct: 0.1,
    cashFlowGrowthPct: 0.03,
    terminalGrowthPct: 0.03,
    dcfProjectionYears: 5,
  }
  const rows = facilityCurrentStateRows(snapshot)
  const flat = rows.map((r) => r.join(": ")).join("\n")

  it("includes the facility name + the four headline figures", () => {
    expect(flat).toMatch(/Facility: Lighthouse Surgical Center/)
    expect(flat).toMatch(/Current vendor spend/)
    expect(flat).toMatch(/Net revenue/)
    expect(flat).toMatch(/EBITDA/)
    expect(flat).toMatch(/DCF enterprise value/)
  })

  it("shows the DCF explicit + terminal breakdown and the manual revenue basis", () => {
    expect(flat).toMatch(/explicit \+/)
    expect(flat).toMatch(/terminal/)
    expect(flat).toMatch(/manual:.*\/case × 674 cases/)
  })
})

// The PDF now renders SERVER-SIDE (Vick 2026-07-02 "make all pdf gen backend
// only"): the client serializes the live model into a payload and POSTs it to
// /api/reports/pdf. These guard that the payload builders carry every section
// the lib/pdf.ts generators render.
describe("buildAnalysisPdfPayload (server-side PDF payload)", () => {
  const model = buildDashboardModel(
    DEFAULT_FACILITY_ASSUMPTIONS,
    625_879,
    DEFAULT_AI_INPUTS,
  )
  const payload = buildAnalysisPdfPayload(
    model,
    DEFAULT_FACILITY_ASSUMPTIONS,
    "Live COG",
  )

  it("carries the narrative + every dashboard section", () => {
    expect(payload.sourceLabel).toBe("Live COG")
    expect(payload.narrative).toMatch(/net revenue/i)
    expect(payload.current.dcf).toBe(model.prospective.current.dcf)
    expect(payload.impact.annualSupplySavings).toBe(
      model.prospective.impact.annualSupplySavings,
    )
    expect(payload.categoryAsp.length).toBe(model.categoryAsp.length)
    expect(payload.vendorShare.length).toBe(model.vendorShare.length)
    expect(payload.contributionMargin.length).toBe(model.contributionMargin.length)
    expect(payload.categoryImpact.length).toBe(model.categoryImpact.length)
    expect(payload.enterpriseValue.length).toBe(
      model.prospective.impact.enterpriseValue.length,
    )
  })

  it("carries the AI layer + conversion targets", () => {
    expect(payload.ai.opportunityOverall).toBe(model.opportunityScore.overall)
    expect(payload.ai.waterfallFutureEbitda).toBe(model.waterfall.futureEbitda)
    expect(payload.ai.paybackYears.length).toBe(model.payback.scenarios.length)
    expect(payload.conversionTargets.targets.length).toBe(
      model.conversionTargets.targets.length,
    )
  })

  it("resolves the terminal-growth default so the server never guesses", () => {
    const noTerminal = { ...DEFAULT_FACILITY_ASSUMPTIONS, terminalGrowthPct: undefined }
    const p = buildAnalysisPdfPayload(model, noTerminal, "Live COG")
    expect(p.assumptions.terminalGrowthPct).toBe(0.03)
  })
})

describe("buildOpportunityPdfPayload (server-side PDF payload)", () => {
  const engine = {
    winProbability: 0.62,
    incrementalRevenue: 1_200_000,
    currentRevenue: 3_000_000,
    targetRevenue: 4_200_000,
    netUnitImpact: 310,
    blendedMarketShare: 0.41,
    territoryRecurringRevenue: 5_000_000,
    capitalRoboticRevenue: 750_000,
  } as unknown as Parameters<typeof buildOpportunityPdfPayload>[0]
  const score = {
    overall: 71,
    financial: [],
    strategic: [],
    winProbability: {
      probability: 0.58,
      riskLevel: "Medium",
      recommendedAction: "Lead with the Target price",
    },
    recommendedOffer: { targetConversionPct: 60, items: ["Bundle rebate"] },
  } as unknown as Parameters<typeof buildOpportunityPdfPayload>[1]
  const snapshot: FacilityCurrentStateSnapshot = {
    facilityName: "Lighthouse Surgical Center",
    currentVendorSpend: 23_700_000,
    netRevenue: 9_900_000,
    ebitda: 2_970_000,
    ebitdaMarginPct: 0.3,
    dcf: 34_000_000,
    dcfExplicit: 9_500_000,
    dcfTerminalValue: 24_400_000,
    annualCaseVolume: 674,
    revenueMode: "manual",
    avgReimbursementPerCase: 14_700,
    dcfPctOfEbitda: 0.8,
    discountRatePct: 0.1,
    cashFlowGrowthPct: 0.03,
    terminalGrowthPct: 0.03,
    dcfProjectionYears: 5,
  }

  const payload = buildOpportunityPdfPayload(
    engine,
    score,
    {
      division: "Ortho",
      facility: "Lighthouse Surgical Center",
      priceChangePct: -0.05,
      targetShare: 0.5,
      expectedVolumeGrowthPct: 0.1,
    },
    snapshot,
    [
      {
        productName: "Total Knee System",
        current: 3200,
        floor: 2800,
        target: 2950,
        ask: 3100,
        annualVolume: 120,
        rebatePercent: 3,
      },
    ],
  )

  it("carries scenario, engine outcomes, and score", () => {
    expect(payload.scenario.division).toBe("Ortho")
    expect(payload.engine.winProbability).toBe(0.62)
    expect(payload.score.overall).toBe(71)
    expect(payload.score.recommendedOffer.items).toEqual(["Bundle rebate"])
  })

  it("leads with the narrative story (section 1 of the PDF + CSV)", () => {
    expect(payload.narrative.length).toBeGreaterThan(0)
    expect(payload.narrative[0]).toMatch(
      /Ortho is pitching Lighthouse Surgical Center/,
    )
    const story = payload.narrative.join(" ")
    // Honest attribution + the full arc: facility → deal → win → offer.
    expect(story).toMatch(/deterministic model/)
    expect(story).toMatch(/net revenue/i)
    expect(story).toMatch(/proposed deal covers 1 product/)
    expect(story).toMatch(/Bundle rebate/)
  })

  it("is honest when no facility snapshot rode along (modeled from defaults)", () => {
    const bare = buildOpportunityPdfPayload(
      engine,
      score,
      payload.scenario,
      null,
      undefined,
    )
    expect(bare.narrative.join(" ")).toMatch(/modeled from default assumptions/)
  })

  it("pre-formats the Facility Current State rows via the ONE shared builder", () => {
    expect(payload.facility?.facilityName).toBe("Lighthouse Surgical Center")
    expect(payload.facility?.rows).toEqual(facilityCurrentStateRows(snapshot))
  })

  it("carries the per-construct deal rows and defaults to [] when absent", () => {
    expect(payload.constructs).toHaveLength(1)
    expect(payload.constructs[0].productName).toBe("Total Knee System")
    const bare = buildOpportunityPdfPayload(
      engine,
      score,
      payload.scenario,
      null,
      undefined,
    )
    expect(bare.facility).toBeNull()
    expect(bare.constructs).toEqual([])
  })
})
