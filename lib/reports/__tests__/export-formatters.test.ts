import { describe, it, expect } from "vitest"
import {
  formatExportDate,
  formatExportDollars,
  formatExportPercent,
  toContractPerformanceCSV,
  toSurgeonPerformanceCSV,
  toRebateAnalysisCSV,
  toInvoiceDiscrepancyCSV,
  toCustomReportCSV,
} from "../export-formatters"

describe("formatExportDate", () => {
  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(formatExportDate(new Date("2026-04-18T15:30:00Z"))).toBe("2026-04-18")
  })

  it("uses UTC regardless of local TZ semantics (epoch 0 → 1970-01-01)", () => {
    expect(formatExportDate(new Date(0))).toBe("1970-01-01")
  })

  it("returns empty string for an invalid Date", () => {
    expect(formatExportDate(new Date("not-a-date"))).toBe("")
  })
})

describe("formatExportDollars", () => {
  it("formats positive number with two decimals and no $ sign", () => {
    expect(formatExportDollars(1234.5)).toBe("1234.50")
  })

  it("formats zero as 0.00", () => {
    expect(formatExportDollars(0)).toBe("0.00")
  })

  it("formats negatives with two decimals", () => {
    expect(formatExportDollars(-42.1)).toBe("-42.10")
  })

  it("returns empty string for non-finite", () => {
    expect(formatExportDollars(Number.NaN)).toBe("")
    expect(formatExportDollars(Number.POSITIVE_INFINITY)).toBe("")
  })
})

describe("formatExportPercent", () => {
  it("formats with 1 decimal and no % sign", () => {
    expect(formatExportPercent(12.345)).toBe("12.3")
    expect(formatExportPercent(100)).toBe("100.0")
  })

  it("returns empty string for NaN", () => {
    expect(formatExportPercent(Number.NaN)).toBe("")
  })
})

describe("toContractPerformanceCSV", () => {
  it("projects every field onto the canonical columns", () => {
    const out = toContractPerformanceCSV({
      vendor: "Acme",
      contractId: "C-100",
      startDate: new Date("2024-01-01T00:00:00Z"),
      endDate: new Date("2025-12-31T00:00:00Z"),
      totalSpend: 1234567.89,
      rebateEarned: 45678.9,
      compliancePercent: 92.5,
    })
    expect(out).toEqual({
      Vendor: "Acme",
      "Contract ID": "C-100",
      "Start Date": "2024-01-01",
      "End Date": "2025-12-31",
      "Total Spend": "1234567.89",
      "Rebate Earned": "45678.90",
      "Compliance %": "92.5",
    })
  })
})

describe("toSurgeonPerformanceCSV", () => {
  it("projects onto canonical columns", () => {
    const out = toSurgeonPerformanceCSV({
      surgeon: "Dr. Chen",
      specialty: "Ortho",
      totalCases: 42,
      avgCaseCost: 5000,
      contractCompliance: 88.2,
      rebateContribution: 12000,
      costEfficiency: 95,
    })
    expect(out["Surgeon"]).toBe("Dr. Chen")
    expect(out["Total Cases"]).toBe("42")
    expect(out["Avg Case Cost"]).toBe("5000.00")
    expect(out["Contract Compliance"]).toBe("88.2")
    expect(out["Rebate Contribution"]).toBe("12000.00")
    expect(out["Cost Efficiency"]).toBe("95.0")
  })
})

describe("toRebateAnalysisCSV", () => {
  it("serializes a max-tier row with null nextTier / spendToNextTier / potential", () => {
    const out = toRebateAnalysisCSV({
      vendor: "Acme",
      contract: "C-100",
      currentTier: "Tier 3",
      nextTier: null,
      currentSpend: 500000,
      spendToNextTier: null,
      potentialAdditionalRebate: null,
    })
    expect(out["Next Tier"]).toBe("")
    expect(out["Spend to Next Tier"]).toBe("")
    expect(out["Potential Additional Rebate"]).toBe("")
    expect(out["Current Spend"]).toBe("500000.00")
  })

  it("serializes a mid-tier row with populated next-tier fields", () => {
    const out = toRebateAnalysisCSV({
      vendor: "Acme",
      contract: "C-100",
      currentTier: "Tier 2",
      nextTier: "Tier 3",
      currentSpend: 500000,
      spendToNextTier: 250000,
      potentialAdditionalRebate: 15000,
    })
    expect(out["Next Tier"]).toBe("Tier 3")
    expect(out["Spend to Next Tier"]).toBe("250000.00")
    expect(out["Potential Additional Rebate"]).toBe("15000.00")
  })
})

describe("toInvoiceDiscrepancyCSV", () => {
  it("formats variance, amounts, and invoice date", () => {
    const out = toInvoiceDiscrepancyCSV({
      invoiceNumber: "INV-1",
      vendor: "Acme",
      invoiceDate: new Date("2026-03-15T00:00:00Z"),
      invoicedAmount: 1000,
      contractAmount: 900,
      variance: 100,
      status: "flagged",
    })
    expect(out["Invoice #"]).toBe("INV-1")
    expect(out["Invoice Date"]).toBe("2026-03-15")
    expect(out["Invoiced Amount"]).toBe("1000.00")
    expect(out["Variance"]).toBe("100.00")
    expect(out["Status"]).toBe("flagged")
  })
})

describe("toCustomReportCSV", () => {
  it("passes through strings", () => {
    const out = toCustomReportCSV({
      category: "Finance",
      metric: "Cash",
      value: "High",
      change: "+5%",
      status: "ok",
    })
    expect(out).toEqual({
      Category: "Finance",
      Metric: "Cash",
      Value: "High",
      Change: "+5%",
      Status: "ok",
    })
  })

  it("stringifies numeric value", () => {
    const out = toCustomReportCSV({
      category: "Ops",
      metric: "Count",
      value: 17,
      change: "+2",
      status: "ok",
    })
    expect(out["Value"]).toBe("17")
  })
})
