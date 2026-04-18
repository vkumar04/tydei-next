import { describe, it, expect } from "vitest"
import {
  adjustNPVForClauseRisk,
  type ClauseFindingForRisk,
} from "../clause-risk-adjustment"

const f = (
  category: string,
  found: boolean,
  overrides: Partial<ClauseFindingForRisk> = {},
): ClauseFindingForRisk => ({
  category,
  found,
  riskLevel: "medium",
  favorability: "neutral",
  ...overrides,
})

describe("adjustNPVForClauseRisk", () => {
  it("returns baseNPV unchanged when no rules trigger", () => {
    const result = adjustNPVForClauseRisk(100_000, [
      f("exclusivity", false),
      f("minimum_commitment", false),
      f("termination_for_convenience", true, { favorability: "facility" }),
      f("auto_renewal", false),
      f("price_protection", false),
    ])
    expect(result.adjustments).toHaveLength(0)
    expect(result.riskAdjustedNPV).toBe(100_000)
    expect(result.totalAdjustmentPercent).toBe(0)
  })

  it("applies -5% for high-risk exclusivity clause", () => {
    const result = adjustNPVForClauseRisk(100_000, [
      f("exclusivity", true, { riskLevel: "high", favorability: "vendor" }),
      f("termination_for_convenience", true, { favorability: "facility" }),
    ])
    expect(result.adjustments).toHaveLength(1)
    expect(result.adjustments[0]).toMatchObject({
      clauseCategory: "exclusivity",
      adjustmentPercent: -5,
    })
    expect(result.riskAdjustedNPV).toBe(95_000)
  })

  it("applies -3% for vendor-favorable minimum commitment", () => {
    const result = adjustNPVForClauseRisk(100_000, [
      f("minimum_commitment", true, { favorability: "vendor" }),
      f("termination_for_convenience", true, { favorability: "facility" }),
    ])
    expect(result.totalAdjustmentPercent).toBe(-3)
    expect(result.riskAdjustedNPV).toBe(97_000)
  })

  it("applies -2% when termination_for_convenience is missing", () => {
    const result = adjustNPVForClauseRisk(100_000, [
      // No termination_for_convenience finding → triggers rule
      f("exclusivity", false),
    ])
    expect(result.adjustments.some((a) => a.clauseCategory === "termination_for_convenience")).toBe(
      true,
    )
    expect(result.totalAdjustmentPercent).toBe(-2)
  })

  it("applies -2% for vendor-favorable auto_renewal", () => {
    const result = adjustNPVForClauseRisk(100_000, [
      f("auto_renewal", true, { favorability: "vendor" }),
      f("termination_for_convenience", true, { favorability: "facility" }),
    ])
    const ar = result.adjustments.find((a) => a.clauseCategory === "auto_renewal")
    expect(ar?.adjustmentPercent).toBe(-2)
  })

  it("applies +2% (credit) for facility-favorable price_protection", () => {
    const result = adjustNPVForClauseRisk(100_000, [
      f("price_protection", true, { favorability: "facility" }),
      f("termination_for_convenience", true, { favorability: "facility" }),
    ])
    const pp = result.adjustments.find((a) => a.clauseCategory === "price_protection")
    expect(pp?.adjustmentPercent).toBe(2)
    expect(result.totalAdjustmentPercent).toBe(2)
    expect(result.riskAdjustedNPV).toBe(102_000)
  })

  it("combines multiple adjustments", () => {
    const result = adjustNPVForClauseRisk(100_000, [
      f("exclusivity", true, { riskLevel: "high", favorability: "vendor" }),
      f("minimum_commitment", true, { favorability: "vendor" }),
      f("auto_renewal", true, { favorability: "vendor" }),
      f("price_protection", true, { favorability: "facility" }),
      // termination_for_convenience missing → triggers -2%
    ])
    // -5 -3 -2 -2 +2 = -10
    expect(result.totalAdjustmentPercent).toBe(-10)
    expect(result.riskAdjustedNPV).toBe(90_000)
    expect(result.adjustments).toHaveLength(5)
  })

  it("exclusivity at medium risk does NOT trigger (only high)", () => {
    const result = adjustNPVForClauseRisk(100_000, [
      f("exclusivity", true, { riskLevel: "medium" }),
      f("termination_for_convenience", true, { favorability: "facility" }),
    ])
    expect(result.adjustments.some((a) => a.clauseCategory === "exclusivity")).toBe(false)
  })

  it("passes findingId through to linkToFinding when present", () => {
    const result = adjustNPVForClauseRisk(100_000, [
      f("exclusivity", true, {
        riskLevel: "high",
        favorability: "vendor",
        findingId: "finding-123",
      }),
      f("termination_for_convenience", true, { favorability: "facility" }),
    ])
    expect(result.adjustments[0].linkToFinding).toBe("finding-123")
  })
})
