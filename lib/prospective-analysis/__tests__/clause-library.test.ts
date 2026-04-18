/**
 * Tests for CLAUSE_LIBRARY — the 25+ clause-category detection library
 * (spec §subsystem-7).
 *
 * Covers: cardinality (≥25 entries), pattern completeness, full
 * ClauseCategory enum coverage, and the spec-mandated set of 6
 * `requiredForRiskAnalysis: true` categories.
 */

import { describe, it, expect } from "vitest"
import {
  CLAUSE_LIBRARY,
  type ClauseCategory,
  type ClauseDetectionRule,
} from "../clause-library"

const ALL_CATEGORIES: ClauseCategory[] = [
  "auto_renewal",
  "termination_for_convenience",
  "termination_for_cause",
  "price_protection",
  "minimum_commitment",
  "exclusivity",
  "payment_terms",
  "rebate_structure",
  "audit_rights",
  "indemnification",
  "governing_law",
  "dispute_resolution",
  "assignment",
  "force_majeure",
  "confidentiality",
  "warranty",
  "limitation_of_liability",
  "ip_ownership",
  "most_favored_nation",
  "volume_commitment",
  "co_op_marketing",
  "data_rights",
  "insurance",
  "compliance_reps",
  "non_solicitation",
  "gpo_affiliation",
]

const REQUIRED_CATEGORIES: ReadonlySet<ClauseCategory> = new Set<ClauseCategory>([
  "termination_for_convenience",
  "audit_rights",
  "indemnification",
  "limitation_of_liability",
  "force_majeure",
  "governing_law",
])

describe("CLAUSE_LIBRARY", () => {
  it("contains at least 25 entries", () => {
    expect(CLAUSE_LIBRARY.length).toBeGreaterThanOrEqual(25)
  })

  it("every entry has at least one regex pattern", () => {
    for (const rule of CLAUSE_LIBRARY) {
      expect(rule.patterns.length).toBeGreaterThanOrEqual(1)
      for (const pattern of rule.patterns) {
        expect(pattern).toBeInstanceOf(RegExp)
      }
    }
  })

  it("covers every ClauseCategory enum value exactly once", () => {
    const seen = new Set<ClauseCategory>()
    for (const rule of CLAUSE_LIBRARY) {
      expect(seen.has(rule.category)).toBe(false)
      seen.add(rule.category)
    }
    for (const category of ALL_CATEGORIES) {
      expect(seen.has(category)).toBe(true)
    }
  })

  it("marks exactly the 6 spec-mandated categories as requiredForRiskAnalysis", () => {
    const required = new Set(
      CLAUSE_LIBRARY.filter(
        (r: ClauseDetectionRule) => r.requiredForRiskAnalysis,
      ).map((r) => r.category),
    )
    expect(required.size).toBe(REQUIRED_CATEGORIES.size)
    for (const cat of REQUIRED_CATEGORIES) {
      expect(required.has(cat)).toBe(true)
    }
  })

  it("every entry has a non-empty recommendedAction", () => {
    for (const rule of CLAUSE_LIBRARY) {
      expect(typeof rule.recommendedAction).toBe("string")
      expect(rule.recommendedAction.length).toBeGreaterThan(0)
    }
  })

  it("every entry has valid risk level + favorability enum values", () => {
    const validRisk = new Set(["low", "medium", "high"])
    const validFav = new Set(["facility", "neutral", "vendor"])
    for (const rule of CLAUSE_LIBRARY) {
      expect(validRisk.has(rule.defaultRiskLevel)).toBe(true)
      expect(validFav.has(rule.defaultFavorability)).toBe(true)
    }
  })
})
