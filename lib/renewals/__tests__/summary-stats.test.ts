import { describe, it, expect } from "vitest"
import {
  computeRenewalSummary,
  type RenewalContractInput,
} from "../summary-stats"

function mk(over: Partial<RenewalContractInput>): RenewalContractInput {
  return {
    id: "c",
    daysUntilExpiration: 365,
    totalSpend: 0,
    rebatesEarned: 0,
    commitmentMet: 100,
    status: "active",
    ...over,
  }
}

describe("computeRenewalSummary", () => {
  it("returns all zeros for empty input", () => {
    expect(computeRenewalSummary([])).toEqual({
      totalContracts: 0,
      criticalCount: 0,
      warningCount: 0,
      upcomingCount: 0,
      okCount: 0,
      atRisk: 0,
      strongPerformers: 0,
      totalAtRiskSpend: 0,
      totalAtRiskRebates: 0,
    })
  })

  it("buckets ≤30 days (inclusive) as critical", () => {
    const s = computeRenewalSummary([
      mk({ id: "a", daysUntilExpiration: 30 }),
      mk({ id: "b", daysUntilExpiration: 1 }),
      mk({ id: "c", daysUntilExpiration: 0 }),
    ])
    expect(s.criticalCount).toBe(3)
    expect(s.warningCount).toBe(0)
  })

  it("counts already-expired (negative days) as critical", () => {
    const s = computeRenewalSummary([
      mk({ id: "a", daysUntilExpiration: -5 }),
      mk({ id: "b", daysUntilExpiration: -100 }),
    ])
    expect(s.criticalCount).toBe(2)
    expect(s.totalContracts).toBe(2)
  })

  it("buckets 31..90 as warning, 91..180 as upcoming, >180 as ok", () => {
    const s = computeRenewalSummary([
      mk({ id: "a", daysUntilExpiration: 31 }),
      mk({ id: "b", daysUntilExpiration: 90 }),
      mk({ id: "c", daysUntilExpiration: 91 }),
      mk({ id: "d", daysUntilExpiration: 180 }),
      mk({ id: "e", daysUntilExpiration: 181 }),
      mk({ id: "f", daysUntilExpiration: 365 }),
    ])
    expect(s.warningCount).toBe(2)
    expect(s.upcomingCount).toBe(2)
    expect(s.okCount).toBe(2)
    expect(s.criticalCount).toBe(0)
  })

  it("counts atRisk when commitmentMet < 80", () => {
    const s = computeRenewalSummary([
      mk({ id: "a", commitmentMet: 79.9 }),
      mk({ id: "b", commitmentMet: 80 }),
      mk({ id: "c", commitmentMet: 50 }),
    ])
    expect(s.atRisk).toBe(2)
  })

  it("counts strongPerformers when commitmentMet >= 100", () => {
    const s = computeRenewalSummary([
      mk({ id: "a", commitmentMet: 99.9 }),
      mk({ id: "b", commitmentMet: 100 }),
      mk({ id: "c", commitmentMet: 120 }),
    ])
    expect(s.strongPerformers).toBe(2)
  })

  it("sums totalAtRiskSpend and totalAtRiskRebates across at-risk rows only", () => {
    const s = computeRenewalSummary([
      mk({ id: "a", commitmentMet: 50, totalSpend: 10000, rebatesEarned: 500 }),
      mk({ id: "b", commitmentMet: 70, totalSpend: 20000, rebatesEarned: 1000 }),
      // Not at-risk — excluded from totals.
      mk({ id: "c", commitmentMet: 95, totalSpend: 99999, rebatesEarned: 9999 }),
    ])
    expect(s.atRisk).toBe(2)
    expect(s.totalAtRiskSpend).toBe(30000)
    expect(s.totalAtRiskRebates).toBe(1500)
  })

  it("computes a mixed real-world rollup correctly", () => {
    const s = computeRenewalSummary([
      mk({ id: "1", daysUntilExpiration: 10, commitmentMet: 60, totalSpend: 100, rebatesEarned: 10 }),
      mk({ id: "2", daysUntilExpiration: 60, commitmentMet: 105, totalSpend: 200, rebatesEarned: 20 }),
      mk({ id: "3", daysUntilExpiration: 150, commitmentMet: 75, totalSpend: 300, rebatesEarned: 30 }),
      mk({ id: "4", daysUntilExpiration: 365, commitmentMet: 100, totalSpend: 400, rebatesEarned: 40 }),
    ])
    expect(s.totalContracts).toBe(4)
    expect(s.criticalCount).toBe(1)
    expect(s.warningCount).toBe(1)
    expect(s.upcomingCount).toBe(1)
    expect(s.okCount).toBe(1)
    expect(s.atRisk).toBe(2) // rows 1 & 3
    expect(s.strongPerformers).toBe(2) // rows 2 & 4
    expect(s.totalAtRiskSpend).toBe(400) // 100 + 300
    expect(s.totalAtRiskRebates).toBe(40) // 10 + 30
  })
})
