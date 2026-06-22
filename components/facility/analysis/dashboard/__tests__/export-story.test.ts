import { describe, it, expect } from "vitest"
import {
  computeFacilityProspectiveModel,
  DEFAULT_FACILITY_ASSUMPTIONS,
} from "@/lib/financial-analysis/prospective-impact-model"
import { buildNarrative } from "@/components/facility/analysis/dashboard/export-analysis"
import { facilityCurrentStateRows } from "@/app/vendor/prospective/sections/export-opportunity"
import type { DashboardModel } from "@/components/facility/analysis/dashboard/model"
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
