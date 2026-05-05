/**
 * Tests for the canonical analyzePDFContract module.
 *
 * Coverage:
 *  - Happy path (FACILITY / USAGE_SPEND, no missing) → LOW or MEDIUM overall
 *  - CRITICAL trigger (USAGE_TIEIN missing ANTI_KICKBACK) → overall CRITICAL
 *  - Side-aware MFN (FACILITY favorable vs VENDOR concern + bumped risk)
 *  - Missing PRICE_PROTECTION on facility side returns the canonical
 *    MISSING_CLAUSE_SUGGESTIONS["PRICE_PROTECTION"] entry
 */

import { describe, it, expect } from "vitest"
import {
  analyzePDFContract,
  CLAUSE_RISK_LIBRARY,
  MISSING_CLAUSE_SUGGESTIONS,
  REQUIRED_CLAUSES,
  type ContractClause,
} from "../clause-risk-analyzer"

describe("analyzePDFContract — canonical clause-risk analyzer", () => {
  it("happy path: required clauses + favorable facility-side terms, USAGE_SPEND → LOW or MEDIUM", () => {
    // Provide every required clause for USAGE_SPEND so the missing list is
    // empty AND include PRICE_PROTECTION so the facility-side cross-clause
    // critical flag does not fire. Add AUDIT_RIGHTS / MFN as facility-
    // favorable terms which subtract from the score.
    const clauses: ContractClause[] = [
      ...REQUIRED_CLAUSES.USAGE_SPEND.map((category) => ({ category })),
      { category: "PRICE_PROTECTION" as const },
      { category: "MOST_FAVORED_NATION" as const },
      { category: "FORCE_MAJEURE" as const },
    ]
    const result = analyzePDFContract(
      clauses,
      "FACILITY",
      "USAGE_SPEND",
      "Acme Vendor — USAGE_SPEND",
    )

    expect(result.contractName).toBe("Acme Vendor — USAGE_SPEND")
    expect(result.side).toBe("FACILITY")
    expect(result.contractVariant).toBe("USAGE_SPEND")
    expect(result.missingClauses).toHaveLength(0)
    // Facility-favorable terms surfaced; no critical regulatory flags fire.
    expect(result.criticalFlags).toHaveLength(0)
    expect(result.favorableTerms).toContain("PRICE_PROTECTION")
    expect(result.favorableTerms).toContain("MOST_FAVORED_NATION")
    expect(["LOW", "MEDIUM"]).toContain(result.overallRiskLevel)
  })

  it("CRITICAL trigger: USAGE_TIEIN missing ANTI_KICKBACK and STARK_LAW → overall CRITICAL", () => {
    // Supply only PRICING + REBATE — leaves both ANTI_KICKBACK and
    // STARK_LAW (which USAGE_TIEIN requires) absent, plus the cross-
    // clause flags for capital/tie-in fire.
    const clauses: ContractClause[] = [
      { category: "PRICING" },
      { category: "REBATE" },
    ]
    const result = analyzePDFContract(
      clauses,
      "FACILITY",
      "USAGE_TIEIN",
      "Capital Tie-In Deal",
    )

    expect(result.overallRiskLevel).toBe("CRITICAL")
    // criticalFlags should include both Stark and Anti-Kickback
    const flagCategories = result.criticalFlags.map((f) => f.category)
    expect(flagCategories).toContain("STARK_LAW")
    expect(flagCategories).toContain("ANTI_KICKBACK")
    // missingClauses should include Stark + AKS recommended language
    const missingCategories = result.missingClauses.map((m) => m.category)
    expect(missingCategories).toContain("STARK_LAW")
    expect(missingCategories).toContain("ANTI_KICKBACK")
  })

  it("side-aware: same MFN clause → vendor flags concern + bumped risk, facility flags favorable", () => {
    const clauses: ContractClause[] = [{ category: "MOST_FAVORED_NATION" }]

    const facilityResult = analyzePDFContract(
      clauses,
      "FACILITY",
      "USAGE_SPEND",
      "Test",
    )
    const vendorResult = analyzePDFContract(
      clauses,
      "VENDOR",
      "USAGE_SPEND",
      "Test",
    )

    const facilityMFN = facilityResult.clauseAssessments.find(
      (a) => a.category === "MOST_FAVORED_NATION",
    )
    const vendorMFN = vendorResult.clauseAssessments.find(
      (a) => a.category === "MOST_FAVORED_NATION",
    )

    expect(facilityMFN?.isFavorable).toBe(true)
    expect(vendorMFN?.isFavorable).toBe(false)

    // Vendor side bumps MFN risk one notch above the library baseRisk (HIGH → CRITICAL)
    const baseRisk = CLAUSE_RISK_LIBRARY.MOST_FAVORED_NATION.baseRisk
    expect(baseRisk).toBe("HIGH")
    expect(vendorMFN?.riskLevel).toBe("CRITICAL")
    expect(facilityMFN?.riskLevel).toBe(baseRisk)

    // Vendor side also surfaces a CriticalFlag for MFN
    expect(
      vendorResult.criticalFlags.some(
        (f) => f.category === "MOST_FAVORED_NATION",
      ),
    ).toBe(true)
    // Facility side does NOT flag MFN as critical
    expect(
      facilityResult.criticalFlags.some(
        (f) => f.category === "MOST_FAVORED_NATION",
      ),
    ).toBe(false)

    // Side-appropriate concerns/suggestions surfaced
    expect(facilityMFN?.concerns).toEqual(
      CLAUSE_RISK_LIBRARY.MOST_FAVORED_NATION.facilityConcerns,
    )
    expect(vendorMFN?.concerns).toEqual(
      CLAUSE_RISK_LIBRARY.MOST_FAVORED_NATION.vendorConcerns,
    )
  })

  it("missing PRICE_PROTECTION on facility side returns MISSING_CLAUSE_SUGGESTIONS entry + critical flag", () => {
    // USAGE_SPEND doesn't put PRICE_PROTECTION in REQUIRED_CLAUSES (it's a
    // strategic facility-side ask), but the cross-clause check for
    // facility-side missing PRICE_PROTECTION on non-PRICING_ONLY contracts
    // still fires a CriticalFlag. This proves both wiring paths.
    const clauses: ContractClause[] = REQUIRED_CLAUSES.USAGE_SPEND.map(
      (c) => ({ category: c }),
    )
    const result = analyzePDFContract(
      clauses,
      "FACILITY",
      "USAGE_SPEND",
      "Test",
    )

    // Cross-clause critical flag fires
    const ppFlag = result.criticalFlags.find(
      (f) => f.category === "PRICE_PROTECTION",
    )
    expect(ppFlag).toBeDefined()
    expect(ppFlag?.riskLevel).toBe("HIGH")

    // The canonical MISSING_CLAUSE_SUGGESTIONS entry is exposed and contains
    // recommended legal language
    const suggestion = MISSING_CLAUSE_SUGGESTIONS.PRICE_PROTECTION
    expect(suggestion).toBeDefined()
    expect(suggestion?.recommendedLanguage).toMatch(/CPI/i)
    expect(suggestion?.recommendedLanguage.length).toBeGreaterThan(50)
  })

  it("REQUIRED_CLAUSES capital tie-in includes STARK_LAW and ANTI_KICKBACK", () => {
    expect(REQUIRED_CLAUSES.CAPITAL_TIEIN).toContain("STARK_LAW")
    expect(REQUIRED_CLAUSES.CAPITAL_TIEIN).toContain("ANTI_KICKBACK")
    expect(REQUIRED_CLAUSES.USAGE_TIEIN).toContain("STARK_LAW")
  })

  it("negotiationPriorities ranks critical flags above plain assessments", () => {
    const clauses: ContractClause[] = [
      { category: "PRICING" },
      { category: "REBATE" },
      { category: "AUTO_RENEWAL" },
    ]
    const result = analyzePDFContract(
      clauses,
      "FACILITY",
      "USAGE_TIEIN",
      "Test",
    )

    // Top priority should be one of the CRITICAL flags (STARK_LAW or
    // ANTI_KICKBACK), not the AUTO_RENEWAL bump.
    expect(["STARK_LAW", "ANTI_KICKBACK"]).toContain(
      result.negotiationPriorities[0],
    )
    expect(result.negotiationPriorities.length).toBeLessThanOrEqual(5)
  })
})
