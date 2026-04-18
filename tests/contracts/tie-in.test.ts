import { describe, it, expect } from "vitest"
import {
  evaluateAllOrNothing,
  evaluateProportional,
  evaluateCrossVendor,
  type TieInMember,
  type MemberPerformance,
} from "@/lib/contracts/tie-in"

const MEMBERS: TieInMember[] = [
  { contractId: "c1", weightPercent: 50, minimumSpend: 100_000 },
  { contractId: "c2", weightPercent: 30, minimumSpend: 50_000 },
  { contractId: "c3", weightPercent: 20, minimumSpend: 25_000 },
]

describe("evaluateAllOrNothing", () => {
  it("compliant when every member meets its minimum", () => {
    const perf: MemberPerformance[] = [
      { contractId: "c1", currentSpend: 120_000, currentRebate: 3_600 },
      { contractId: "c2", currentSpend: 60_000, currentRebate: 1_800 },
      { contractId: "c3", currentSpend: 30_000, currentRebate: 900 },
    ]
    const r = evaluateAllOrNothing(MEMBERS, perf, { bonusMultiplier: 1.1 })
    expect(r.complianceStatus).toBe("compliant")
    expect(r.baseRebate).toBe(3_600 + 1_800 + 900)
    expect(r.bonusRebate).toBeCloseTo((3_600 + 1_800 + 900) * 0.1, 2)
    expect(r.totalRebate).toBeCloseTo((3_600 + 1_800 + 900) * 1.1, 2)
  })

  it("non-compliant when one member misses minimum: zero bonus", () => {
    const perf: MemberPerformance[] = [
      { contractId: "c1", currentSpend: 120_000, currentRebate: 3_600 },
      { contractId: "c2", currentSpend: 40_000, currentRebate: 1_200 }, // under $50K min
      { contractId: "c3", currentSpend: 30_000, currentRebate: 900 },
    ]
    const r = evaluateAllOrNothing(MEMBERS, perf, { bonusMultiplier: 1.1 })
    expect(r.complianceStatus).toBe("non_compliant")
    expect(r.bonusRebate).toBe(0)
    expect(r.totalRebate).toBe(3_600 + 1_200 + 900) // base only
    expect(r.failingMembers).toContain("c2")
  })

  it("no bonus multiplier defaults bonus to 0 even when compliant", () => {
    const perf: MemberPerformance[] = [
      { contractId: "c1", currentSpend: 120_000, currentRebate: 3_600 },
      { contractId: "c2", currentSpend: 60_000, currentRebate: 1_800 },
      { contractId: "c3", currentSpend: 30_000, currentRebate: 900 },
    ]
    const r = evaluateAllOrNothing(MEMBERS, perf, {})
    expect(r.complianceStatus).toBe("compliant")
    expect(r.bonusRebate).toBe(0)
    expect(r.totalRebate).toBe(r.baseRebate)
  })
})

describe("evaluateProportional", () => {
  it("weighted compliance across members", () => {
    const perf: MemberPerformance[] = [
      { contractId: "c1", currentSpend: 100_000, currentRebate: 3_000 }, // 100% of $100K min
      { contractId: "c2", currentSpend: 25_000, currentRebate: 750 },    // 50% of $50K min
      { contractId: "c3", currentSpend: 20_000, currentRebate: 600 },    // 80% of $25K min
    ]
    const r = evaluateProportional(MEMBERS, perf)
    // Weighted: 100%×0.5 + 50%×0.3 + 80%×0.2 = 50 + 15 + 16 = 81
    expect(r.weightedCompliancePercent).toBeCloseTo(81, 2)
    expect(r.complianceStatus).toBe("partial")
    expect(r.totalRebate).toBe(3_000 + 750 + 600)
  })

  it("all members at 100% returns compliant", () => {
    const perf: MemberPerformance[] = [
      { contractId: "c1", currentSpend: 100_000, currentRebate: 3_000 },
      { contractId: "c2", currentSpend: 50_000, currentRebate: 1_500 },
      { contractId: "c3", currentSpend: 25_000, currentRebate: 750 },
    ]
    const r = evaluateProportional(MEMBERS, perf)
    expect(r.weightedCompliancePercent).toBe(100)
    expect(r.complianceStatus).toBe("compliant")
  })

  it("caps each member's compliance contribution at 100%", () => {
    const perf: MemberPerformance[] = [
      { contractId: "c1", currentSpend: 300_000, currentRebate: 9_000 }, // 3x min
      { contractId: "c2", currentSpend: 50_000, currentRebate: 1_500 },
      { contractId: "c3", currentSpend: 25_000, currentRebate: 750 },
    ]
    const r = evaluateProportional(MEMBERS, perf)
    expect(r.weightedCompliancePercent).toBe(100)
  })
})

describe("evaluateCrossVendor", () => {
  it("grants facility bonus when all vendors in bundle are compliant", () => {
    const perf: MemberPerformance[] = [
      { contractId: "c1", currentSpend: 120_000, currentRebate: 3_600 },
      { contractId: "c2", currentSpend: 60_000, currentRebate: 1_800 },
      { contractId: "c3", currentSpend: 30_000, currentRebate: 900 },
    ]
    const r = evaluateCrossVendor(MEMBERS, perf, { facilityBonusPercent: 2 })
    expect(r.facilityBonus).toBeCloseTo(0.02 * (3_600 + 1_800 + 900), 2)
    expect(r.totalWithBonus).toBeCloseTo((3_600 + 1_800 + 900) * 1.02, 2)
  })

  it("no facility bonus when any vendor is non-compliant", () => {
    const perf: MemberPerformance[] = [
      { contractId: "c1", currentSpend: 120_000, currentRebate: 3_600 },
      { contractId: "c2", currentSpend: 40_000, currentRebate: 1_200 },
      { contractId: "c3", currentSpend: 30_000, currentRebate: 900 },
    ]
    const r = evaluateCrossVendor(MEMBERS, perf, { facilityBonusPercent: 2 })
    expect(r.facilityBonus).toBe(0)
    expect(r.totalWithBonus).toBe(3_600 + 1_200 + 900)
  })
})
