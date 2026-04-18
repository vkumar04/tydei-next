import { describe, it, expect } from "vitest"
import {
  classifyReportPrompt,
  buildCSVFilename,
  REPORT_COLUMN_TEMPLATES,
  type ReportType,
} from "../report-classifier"

describe("classifyReportPrompt", () => {
  it("classifies contract-oriented prompts as contract_performance", () => {
    expect(
      classifyReportPrompt("How are our top contracts performing this quarter?"),
    ).toBe("contract_performance")
  })

  it("prefers vendor/contract over rebate when multiple tokens appear", () => {
    expect(classifyReportPrompt("Show vendor performance")).toBe(
      "contract_performance",
    )
  })

  it("classifies surgeon prompts as surgeon_performance", () => {
    expect(classifyReportPrompt("Which surgeons have best efficiency?")).toBe(
      "surgeon_performance",
    )
  })

  it("classifies physician prompts as surgeon_performance", () => {
    expect(classifyReportPrompt("Top physician utilization")).toBe(
      "surgeon_performance",
    )
  })

  it("classifies rebate opportunities as rebate_analysis", () => {
    expect(
      classifyReportPrompt("What are our top rebate opportunities?"),
    ).toBe("rebate_analysis")
  })

  it("routes 'contract' before 'tier' when both are present", () => {
    // contract rule is rule 1; tier rule is rule 3 — contract wins.
    expect(classifyReportPrompt("Show tier progress for all contracts")).toBe(
      "contract_performance",
    )
  })

  it("routes standalone 'tier progress' to rebate_analysis", () => {
    expect(classifyReportPrompt("tier progress")).toBe("rebate_analysis")
  })

  it("classifies invoice discrepancies as invoice_discrepancy", () => {
    expect(classifyReportPrompt("Show invoice discrepancies")).toBe(
      "invoice_discrepancy",
    )
  })

  it("classifies variance reports as invoice_discrepancy", () => {
    expect(classifyReportPrompt("variance report")).toBe("invoice_discrepancy")
  })

  it("falls back to custom when no trigger words are present", () => {
    expect(classifyReportPrompt("General spend summary")).toBe("custom")
  })

  it("returns custom for an empty string", () => {
    expect(classifyReportPrompt("")).toBe("custom")
  })

  it("is case-insensitive", () => {
    expect(classifyReportPrompt("CONTRACT review")).toBe("contract_performance")
    expect(classifyReportPrompt("Rebate YTD")).toBe("rebate_analysis")
  })

  it("does substring (not word-boundary) matching — 'contractual' still hits 'contract'", () => {
    expect(classifyReportPrompt("Review contractual obligations")).toBe(
      "contract_performance",
    )
  })

  it("tolerates null/undefined-ish input gracefully", () => {
    // classifyReportPrompt coerces to lowercase — make sure no throw on empty-ish.
    expect(classifyReportPrompt("   ")).toBe("custom")
  })
})

describe("REPORT_COLUMN_TEMPLATES", () => {
  it("has the expected column counts per spec §4.4 (7/7/7/7/5)", () => {
    expect(REPORT_COLUMN_TEMPLATES.contract_performance).toHaveLength(7)
    expect(REPORT_COLUMN_TEMPLATES.surgeon_performance).toHaveLength(7)
    expect(REPORT_COLUMN_TEMPLATES.rebate_analysis).toHaveLength(7)
    expect(REPORT_COLUMN_TEMPLATES.invoice_discrepancy).toHaveLength(7)
    expect(REPORT_COLUMN_TEMPLATES.custom).toHaveLength(5)
  })

  it("defines a template for every ReportType", () => {
    const keys: ReportType[] = [
      "contract_performance",
      "surgeon_performance",
      "rebate_analysis",
      "invoice_discrepancy",
      "custom",
    ]
    for (const k of keys) {
      expect(Array.isArray(REPORT_COLUMN_TEMPLATES[k])).toBe(true)
      expect(REPORT_COLUMN_TEMPLATES[k].length).toBeGreaterThan(0)
    }
  })

  it("uses the exact spec column names for contract_performance", () => {
    expect(REPORT_COLUMN_TEMPLATES.contract_performance).toEqual([
      "Vendor",
      "Contract ID",
      "Start Date",
      "End Date",
      "Total Spend",
      "Rebate Earned",
      "Compliance %",
    ])
  })

  it("uses the exact spec column names for invoice_discrepancy", () => {
    expect(REPORT_COLUMN_TEMPLATES.invoice_discrepancy).toEqual([
      "Invoice #",
      "Vendor",
      "Invoice Date",
      "Invoiced Amount",
      "Contract Amount",
      "Variance",
      "Status",
    ])
  })
})

describe("buildCSVFilename", () => {
  it("produces the canonical title_YYYY-MM-DD.csv format", () => {
    expect(
      buildCSVFilename("Contract Performance Summary", new Date("2026-04-18")),
    ).toBe("Contract_Performance_Summary_2026-04-18.csv")
  })

  it("collapses multiple whitespace into single underscores", () => {
    expect(
      buildCSVFilename("Contract   Performance\tSummary", new Date("2026-04-18")),
    ).toBe("Contract_Performance_Summary_2026-04-18.csv")
  })

  it("strips filesystem-hostile special characters", () => {
    expect(
      buildCSVFilename('Q2/2026 "Rebate" Report?', new Date("2026-04-18")),
    ).toBe("Q22026_Rebate_Report_2026-04-18.csv")
  })

  it("defaults to today's date when no date is provided", () => {
    const filename = buildCSVFilename("Quick Report")
    const today = new Date().toISOString().slice(0, 10)
    expect(filename).toBe(`Quick_Report_${today}.csv`)
  })

  it("uses ISO date slice(0,10) for the YYYY-MM-DD component", () => {
    const mid = new Date("2026-04-18T18:30:00.000Z")
    expect(buildCSVFilename("Test", mid)).toBe("Test_2026-04-18.csv")
  })

  it("handles a title that is already snake-cased", () => {
    expect(buildCSVFilename("already_snake", new Date("2026-04-18"))).toBe(
      "already_snake_2026-04-18.csv",
    )
  })
})
