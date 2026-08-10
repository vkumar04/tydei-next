import { describe, it, expect } from "vitest"
import { parseProformaMatrix } from "../parse-proforma-rows"
import { DEFAULT_PROFORMA_LINE_ITEMS } from "@/lib/financial-analysis/proforma-pnl"

// The real Steady State Proforma, as it appears in a spreadsheet: a label
// column and an amount column, section headers interleaved, accounting
// negatives, and a computed total the parser must ignore.
const REAL_STATEMENT: string[][] = [
  ["Steady State Proforma", "1.2x Medicare"],
  ["", ""],
  ["Revenue", ""],
  ["Revenue - standard billing rate", "$267,441,411"],
  ["Revenue - contractual adjustment", "(235,348,442)"],
  ["Total Revenue", "$32,092,969"],
  ["", ""],
  ["Variable Expenses", ""],
  ["Salary and benefits", "2,987,260"],
  ["Medical supplies and services", "12,316,248"],
  ["Small equipment purchases", "6,000"],
  ["Office expenses", "12,000"],
  ["Legal", "6,000"],
  ["Computer services", "33,600"],
  ["Management fees", "962,789"],
  ["Billing and collection", "962,789"],
  ["Other outside services", "154,000"],
  ["Total Variable Expenses", "17,440,686"],
  ["", ""],
  ["Fixed Expenses", ""],
  ["Insurance", "60,000"],
  ["Administrative expenses", "52,800"],
  ["Rent / TI amortization / utilities", "1,095,996"],
  ["Other facility expenses", "60,540"],
  ["Repairs & maintenance", "36,000"],
  ["Property tax", "68,400"],
  ["State taxes", "0"],
  ["Software maintenance", "66,000"],
  ["Equip rent / interest / other", "747,084"],
  ["Total Fixed Expenses", "2,186,820"],
  ["", ""],
  ["Case volume", "5,200"],
  ["Net Operating Income", "12,465,463"],
]

describe("parseProformaMatrix — real statement", () => {
  const parsed = parseProformaMatrix(REAL_STATEMENT)

  it("recovers every one of the 22 line items", () => {
    expect(parsed.matchedFields).toHaveLength(21)
    // Round-trips to the seeded defaults, which came from this same statement.
    expect(parsed.lineItems).toEqual(DEFAULT_PROFORMA_LINE_ITEMS)
  })

  it("stores the contractual adjustment positive despite accounting parens", () => {
    expect(parsed.lineItems.contractualAdjustment).toBe(235_348_442)
  })

  it("ignores section headers and computed totals", () => {
    // "Total Revenue" 32,092,969 must NOT have landed on a line item.
    expect(parsed.lineItems.standardBillingRevenue).toBe(267_441_411)
    expect(parsed.unmatchedLabels).not.toContain("Total Revenue")
    expect(parsed.unmatchedLabels).not.toContain("Net Operating Income")
  })

  it("reads an explicit zero as a value, not a blank", () => {
    expect(parsed.lineItems.stateTaxes).toBe(0)
    expect(parsed.matchedFields).toContain("stateTaxes")
  })
})

describe("parseProformaMatrix — label tolerance", () => {
  const parse = (label: string, value = "1000") =>
    parseProformaMatrix([[label, value]])

  it("matches common label variants", () => {
    expect(parse("Standard Billing Revenue").lineItems.standardBillingRevenue).toBe(1000)
    expect(parse("Gross charges").lineItems.standardBillingRevenue).toBe(1000)
    expect(parse("Salaries and Benefits").lineItems.salaryBenefits).toBe(1000)
    expect(parse("MEDICAL SUPPLIES").lineItems.medicalSupplies).toBe(1000)
    expect(parse("supply expense").lineItems.medicalSupplies).toBe(1000)
    expect(parse("Annual cases", "5200").lineItems.caseVolume).toBe(5200)
  })

  it("does not let 'contractual adjustment' fall through to revenue", () => {
    const p = parse("Revenue — contractual adjustment", "500")
    expect(p.lineItems.contractualAdjustment).toBe(500)
    expect(p.lineItems.standardBillingRevenue).toBe(0)
  })

  it("reports unrecognized labels that carry an amount", () => {
    const p = parseProformaMatrix([["Anesthesia stipend", "125,000"]])
    expect(p.matchedFields).toHaveLength(0)
    expect(p.unmatchedLabels).toEqual(["Anesthesia stipend"])
  })

  it("keeps the first occurrence when a label repeats", () => {
    const p = parseProformaMatrix([
      ["Medical supplies", "100"],
      ["Medical supplies", "999"],
    ])
    expect(p.lineItems.medicalSupplies).toBe(100)
  })
})

describe("parseProformaMatrix — sheet shape tolerance", () => {
  it("finds the amount past leading blank and label-only columns", () => {
    const p = parseProformaMatrix([["", "Medical supplies", "", "12,316,248", "2,368"]])
    expect(p.lineItems.medicalSupplies).toBe(12_316_248)
  })

  it("skips rows with no label and rows with no amount", () => {
    const p = parseProformaMatrix([
      ["", "", ""],
      ["Medical supplies", ""],
      ["12345", "678"],
    ])
    expect(p.matchedFields).toHaveLength(0)
  })

  it("returns all-zero line items for an empty sheet", () => {
    const p = parseProformaMatrix([])
    expect(p.matchedFields).toHaveLength(0)
    expect(p.lineItems.medicalSupplies).toBe(0)
    expect(p.lineItems.caseVolume).toBe(0)
  })

  it("handles a two-column CSV-derived matrix with a header-ish first row", () => {
    const p = parseProformaMatrix([
      ["Line item", "Amount"],
      ["Medical supplies and services", "12,316,248"],
      ["Case volume", "5,200"],
    ])
    expect(p.lineItems.medicalSupplies).toBe(12_316_248)
    expect(p.lineItems.caseVolume).toBe(5_200)
  })
})

// ─── Audit regressions (2026-08-10) ──────────────────────────────
// Each of these silently produced a WRONG financial number, with a success
// toast — the worst failure mode for this feature.

describe("parseProformaMatrix — audit regressions", () => {
  it("does not discard real lines whose label starts with 'total'", () => {
    // A `startsWith("total")` ignore rule also ate "Total charges" and
    // "Total cases" — which are this parser's own aliases for revenue and
    // case volume, so a statement using them lost both.
    const p = parseProformaMatrix([
      ["Total charges", "267,441,411"],
      ["Total cases", "5,200"],
      ["Total Revenue", "32,092,969"], // a genuine computed total
    ])
    expect(p.lineItems.standardBillingRevenue).toBe(267_441_411)
    expect(p.lineItems.caseVolume).toBe(5_200)
    // The computed total is still ignored, not mistaken for a line item.
    expect(p.unmatchedLabels).not.toContain("Total Revenue")
  })

  it("stores expenses positive even when the statement parenthesizes them", () => {
    // Expenses are subtracted downstream; a negative would ADD to NOI and
    // inflate every customer-facing figure.
    const p = parseProformaMatrix([
      ["Salary and benefits", "(2,987,260)"],
      ["Medical supplies and services", "(12,316,248)"],
      ["Insurance", "-60,000"],
    ])
    expect(p.lineItems.salaryBenefits).toBe(2_987_260)
    expect(p.lineItems.medicalSupplies).toBe(12_316_248)
    expect(p.lineItems.insurance).toBe(60_000)
  })

  it("routes a label to the most specific alias, not the first in list order", () => {
    // "Equipment rent / interest / other" contains the short alias "rent",
    // which used to capture it for rentTiUtilities and drop the real line.
    const p = parseProformaMatrix([
      ["Rent / TI amortization / utilities", "1,095,996"],
      ["Equip rent / interest / other", "747,084"],
    ])
    expect(p.lineItems.rentTiUtilities).toBe(1_095_996)
    expect(p.lineItems.equipRentInterestOther).toBe(747_084)
  })

  it("skips a %-of-revenue column and takes the dollar column", () => {
    // Reading "35.5%" as $35.50 is a three-orders-of-magnitude error.
    const p = parseProformaMatrix([
      ["Medical supplies and services", "35.5%", "12,316,248"],
    ])
    expect(p.lineItems.medicalSupplies).toBe(12_316_248)
  })

  it("treats a non-numeric cell as absent rather than $0", () => {
    const p = parseProformaMatrix([["Medical supplies and services", "n/a"]])
    expect(p.matchedFields).not.toContain("medicalSupplies")
  })
})
