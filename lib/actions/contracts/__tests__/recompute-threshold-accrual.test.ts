/**
 * Charles 2026-04-25: threshold-based rebate dispatcher tests
 * (compliance_rebate + market_share share this bridge).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { deleteManyMock, createManyMock } = vi.hoisted(() => ({
  deleteManyMock: vi.fn(),
  createManyMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    rebate: { deleteMany: deleteManyMock, createMany: createManyMock },
  },
}))

import { recomputeThresholdAccrualForTerm } from "@/lib/contracts/recompute/threshold"

const TERM = {
  id: "term-1",
  evaluationPeriod: "annual",
  effectiveStart: new Date(Date.UTC(2025, 0, 1)),
  effectiveEnd: new Date(Date.UTC(2026, 11, 31)),
  // Tiers: spendMin = threshold percent; rebateValue = flat $ per period.
  tiers: [
    { tierNumber: 1, tierName: "T1", spendMin: 70, spendMax: 89, rebateValue: 5_000 },
    { tierNumber: 2, tierName: "T2", spendMin: 90, spendMax: null, rebateValue: 15_000 },
  ],
}

beforeEach(() => {
  deleteManyMock.mockReset().mockResolvedValue({ count: 0 })
  createManyMock.mockReset().mockResolvedValue({ count: 0 })
})

describe("recomputeThresholdAccrualForTerm", () => {
  it("metric crosses top tier → top-tier flat rebate per period", async () => {
    const r = await recomputeThresholdAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      metric: "complianceRate",
      metricValue: 95,
      term: TERM,
    })
    // 1 annual period in window × $15K = $15K.
    expect(r.sumEarned).toBe(15_000)
    expect(r.inserted).toBe(1)
  })

  it("metric below lowest threshold → no rebate", async () => {
    const r = await recomputeThresholdAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      metric: "complianceRate",
      metricValue: 50,
      term: TERM,
    })
    expect(r).toEqual({ inserted: 0, sumEarned: 0 })
  })

  it("metric value null → no qualification (compliance not yet tracked)", async () => {
    const r = await recomputeThresholdAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      metric: "complianceRate",
      metricValue: null,
      term: TERM,
    })
    expect(r).toEqual({ inserted: 0, sumEarned: 0 })
    expect(deleteManyMock).not.toHaveBeenCalled()
  })

  it("annotates the notes with metric name + value + tier", async () => {
    await recomputeThresholdAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      metric: "currentMarketShare",
      metricValue: 92.5,
      term: TERM,
    })
    expect(createManyMock).toHaveBeenCalledOnce()
    const data = createManyMock.mock.calls[0][0].data
    expect(data[0].notes).toContain("currentMarketShare=92.5%")
    expect(data[0].notes).toContain("tier 2")
    expect(data[0].notes).toContain("$15000.00")
  })

  it("idempotent: deletes prior auto-threshold rows for the term", async () => {
    await recomputeThresholdAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      metric: "complianceRate",
      metricValue: 95,
      term: TERM,
    })
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: {
        contractId: "c-1",
        collectionDate: null,
        notes: { startsWith: "[auto-threshold-accrual] term:term-1" },
      },
    })
  })

  // Bug 2026-06-08 ("market share needs 0% to get a rebate and nothing is
  // coming up"). A 0%-threshold market-share tier means "always qualifies."
  // currentMarketShare is often null (not set / no categorized COG to
  // derive from); previously null short-circuited with zero rows so the
  // 0-threshold tier never paid. For market_share, null is treated as 0%.
  const MS_TERM_WITH_ZERO_TIER = {
    id: "term-ms",
    evaluationPeriod: "annual",
    effectiveStart: new Date(Date.UTC(2024, 0, 1)),
    effectiveEnd: new Date(Date.UTC(2024, 11, 31)),
    termType: "market_share",
    tiers: [
      // 0%+ → flat $5,000 per period (fixed_rebate so it pays a dollar amount
      // regardless of spend).
      {
        tierNumber: 1,
        tierName: "Base",
        spendMin: 0,
        spendMax: 59,
        rebateValue: 5_000,
        rebateType: "fixed_rebate",
      },
      {
        tierNumber: 2,
        tierName: "Stretch",
        spendMin: 60,
        spendMax: null,
        rebateValue: 12_000,
        rebateType: "fixed_rebate",
      },
    ],
  }

  it("market_share + null metric → 0% qualifies the 0-threshold tier", async () => {
    const r = await recomputeThresholdAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2024, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2024, 11, 31)),
      metric: "currentMarketShare",
      metricValue: null,
      term: MS_TERM_WITH_ZERO_TIER,
    })
    // One annual period in the 2024 window × $5,000 (tier 1, the 0% tier).
    expect(r.inserted).toBe(1)
    expect(r.sumEarned).toBe(5_000)
    const data = createManyMock.mock.calls[0][0].data
    expect(data[0].notes).toContain("currentMarketShare=0.0%")
    expect(data[0].notes).toContain("tier 1")
  })

  it("compliance + null metric still writes no rows (untracked ≠ 0%)", async () => {
    const r = await recomputeThresholdAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2024, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2024, 11, 31)),
      metric: "complianceRate",
      metricValue: null,
      term: { ...MS_TERM_WITH_ZERO_TIER, id: "term-comp", termType: "compliance_rebate" },
    })
    expect(r).toEqual({ inserted: 0, sumEarned: 0 })
    expect(createManyMock).not.toHaveBeenCalled()
  })
})
