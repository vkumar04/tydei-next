/**
 * Tests for analyzePDFContract — PDF clause analyzer (spec §subsystem-7).
 *
 * Covers: single-clause detection, missing-required-clause flagging,
 * empty-input edge case, ±100-char quote extraction, overall risk score
 * bounds, and summary string format.
 */

import { describe, it, expect } from "vitest"
import { analyzePDFContract } from "../pdf-clause-analyzer"
import { CLAUSE_LIBRARY, type ClauseCategory } from "../clause-library"

const REQUIRED_CATEGORIES: ClauseCategory[] = [
  "termination_for_convenience",
  "audit_rights",
  "indemnification",
  "limitation_of_liability",
  "force_majeure",
  "governing_law",
]

describe("analyzePDFContract", () => {
  it("detects auto_renewal in sample text", () => {
    const pdfText =
      "This agreement shall automatically renew for successive one-year terms unless either party provides written notice."
    const result = analyzePDFContract(pdfText)
    const finding = result.findings.find((f) => f.category === "auto_renewal")
    expect(finding).toBeDefined()
    expect(finding?.found).toBe(true)
    expect(finding?.quote).toContain("automatically renew")
  })

  it("flags missing termination_for_convenience + audit_rights when absent", () => {
    const pdfText =
      "This agreement shall automatically renew for successive one-year terms unless either party provides written notice."
    const result = analyzePDFContract(pdfText)
    expect(result.missingHighRiskCategories).toContain(
      "termination_for_convenience",
    )
    expect(result.missingHighRiskCategories).toContain("audit_rights")
  })

  it("empty pdfText → every finding.found = false and all 6 required are missing", () => {
    const result = analyzePDFContract("")
    expect(result.findings.length).toBe(CLAUSE_LIBRARY.length)
    for (const finding of result.findings) {
      expect(finding.found).toBe(false)
      expect(finding.quote).toBeNull()
      expect(finding.recommendedAction).toBeNull()
    }
    expect(result.missingHighRiskCategories.length).toBe(
      REQUIRED_CATEGORIES.length,
    )
    for (const cat of REQUIRED_CATEGORIES) {
      expect(result.missingHighRiskCategories).toContain(cat)
    }
  })

  it("quote captures ±100 chars of surrounding context", () => {
    const prefix = "A".repeat(150)
    const suffix = "B".repeat(150)
    const clause = "termination for convenience"
    const pdfText = `${prefix}${clause}${suffix}`
    const result = analyzePDFContract(pdfText)
    const finding = result.findings.find(
      (f) => f.category === "termination_for_convenience",
    )
    expect(finding?.found).toBe(true)
    // Expect ±100 chars of window: 100 A's, the clause, 100 B's.
    expect(finding?.quote).toContain(clause)
    // Count A's and B's in the quote — should be exactly 100 each.
    const aCount = (finding?.quote?.match(/A/g) ?? []).length
    const bCount = (finding?.quote?.match(/B/g) ?? []).length
    expect(aCount).toBe(100)
    expect(bCount).toBe(100)
  })

  it("overallRiskScore is always within [0, 10]", () => {
    const empty = analyzePDFContract("")
    expect(empty.overallRiskScore).toBeGreaterThanOrEqual(0)
    expect(empty.overallRiskScore).toBeLessThanOrEqual(10)

    const rich = analyzePDFContract(
      `This agreement shall automatically renew for successive one-year terms.
       Vendor is the exclusive provider. Minimum purchase commitment of $1M.
       Termination for convenience permitted with 30 days' notice.
       Audit rights granted. Indemnification shall be mutual.
       Governed by the laws of the State of Delaware.
       Force majeure events include act of god.
       Limitation of liability: in no event shall liability exceed the fees paid.`,
    )
    expect(rich.overallRiskScore).toBeGreaterThanOrEqual(0)
    expect(rich.overallRiskScore).toBeLessThanOrEqual(10)
  })

  it("summary string mentions the found count", () => {
    const result = analyzePDFContract("")
    expect(result.summary).toMatch(/Found 0 of \d+ key clauses/)

    const partial = analyzePDFContract(
      "This agreement shall automatically renew. Payment terms: Net 60 days.",
    )
    expect(partial.summary).toMatch(/Found \d+ of \d+ key clauses/)
    const foundCount = partial.findings.filter((f) => f.found).length
    expect(partial.summary).toContain(`Found ${foundCount} of`)
  })

  it("detects exclusivity with high-risk vendor-favorable defaults", () => {
    const pdfText = "Vendor shall be the exclusive provider of widgets."
    const result = analyzePDFContract(pdfText)
    const finding = result.findings.find((f) => f.category === "exclusivity")
    expect(finding?.found).toBe(true)
    expect(finding?.riskLevel).toBe("high")
    expect(finding?.favorability).toBe("vendor")
    expect(finding?.recommendedAction).toBeTruthy()
  })

  it("detects most_favored_nation clause", () => {
    const pdfText =
      "Vendor offers most favored nation pricing: no less favorable terms than any other customer."
    const result = analyzePDFContract(pdfText)
    const finding = result.findings.find(
      (f) => f.category === "most_favored_nation",
    )
    expect(finding?.found).toBe(true)
    expect(finding?.favorability).toBe("facility")
  })

  it("returns one finding per clause library rule", () => {
    const result = analyzePDFContract("arbitrary text with no clauses")
    expect(result.findings.length).toBe(CLAUSE_LIBRARY.length)
  })

  it("handles text shorter than the quote context window", () => {
    const pdfText = "automatically renew"
    const result = analyzePDFContract(pdfText)
    const finding = result.findings.find((f) => f.category === "auto_renewal")
    expect(finding?.found).toBe(true)
    expect(finding?.quote).toBe("automatically renew")
  })
})
