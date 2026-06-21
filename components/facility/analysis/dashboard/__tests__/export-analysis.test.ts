import { describe, it, expect } from "vitest"
import { buildDashboardModel, DEFAULT_AI_INPUTS } from "../model"
import { DEFAULT_FACILITY_ASSUMPTIONS } from "@/lib/financial-analysis/prospective-impact-model"
import { buildAnalysisCsv } from "../export-analysis"

describe("buildAnalysisCsv", () => {
  const model = buildDashboardModel(
    DEFAULT_FACILITY_ASSUMPTIONS,
    625_900,
    DEFAULT_AI_INPUTS,
  )
  const csv = buildAnalysisCsv(model)

  it("includes every section header", () => {
    for (const h of [
      "Current State Analysis",
      "Category Spend & ASP",
      "Vendor Market Share",
      "Contribution Margin by Procedure",
      "Enterprise Value Impact",
    ]) {
      expect(csv).toContain(h)
    }
  })

  it("emits the KPI rows with the model's raw numeric values (RFC-4180 quoted)", () => {
    expect(csv).toContain(`"EBITDA","${model.prospective.current.ebitda}"`)
    expect(csv).toContain(
      `"Negotiated Annual Savings","${model.prospective.impact.annualSupplySavings}"`,
    )
    expect(csv).toContain(
      `"Net Revenue","${model.prospective.current.netRevenue}"`,
    )
  })

  it("is a multi-row, comma-delimited document", () => {
    expect(csv).toContain(",")
    expect(csv.split("\n").length).toBeGreaterThan(12)
  })

  it("renders the EV scenarios block with all three multiples", () => {
    for (const s of ["conservative", "expected", "aggressive"]) {
      expect(csv).toContain(s)
    }
  })
})
