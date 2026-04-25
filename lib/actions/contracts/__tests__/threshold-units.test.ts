/**
 * Charles 2026-04-25 (audit follow-up): unit-convention lock for the
 * compliance_rebate + market_share threshold dispatcher.
 *
 * Both `Contract.complianceRate` / `Contract.currentMarketShare`
 * (schema `Decimal(5,2)`) and tier `spendMin` are stored as percent
 * points (0-100) — the form writes `Number(v)` directly from a
 * `<Input min=0 max=100>`. The dispatcher must compare the raw
 * `metricValue` against `spendMin` without any × 100 / ÷ 100 fudge.
 *
 * This test pins that convention so a future refactor can't silently
 * switch one side to fractions without breaking a test.
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

import { recomputeThresholdAccrualForTerm } from "@/lib/actions/contracts/recompute-threshold-accrual"

const baseTerm = {
  id: "term-units",
  evaluationPeriod: "annual" as const,
  effectiveStart: new Date(Date.UTC(2025, 0, 1)),
  effectiveEnd: new Date(Date.UTC(2025, 11, 31)),
  tiers: [
    {
      tierNumber: 1,
      tierName: null,
      spendMin: 80, // 80% threshold
      spendMax: null,
      rebateValue: 10_000,
    },
  ],
}

beforeEach(() => {
  deleteManyMock.mockReset().mockResolvedValue({ count: 0 })
  createManyMock.mockReset().mockResolvedValue({ count: 0 })
})

describe("threshold dispatcher unit convention (percent 0-100)", () => {
  it("metricValue=85 (percent points) clears spendMin=80 → tier achieved", async () => {
    const r = await recomputeThresholdAccrualForTerm({
      contractId: "c",
      facilityId: "f",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      metric: "complianceRate",
      metricValue: 85,
      term: baseTerm,
    })
    expect(r.inserted).toBe(1)
    expect(r.sumEarned).toBe(10_000)
  })

  it("metricValue=0.85 (fraction by mistake) does NOT clear spendMin=80 → no rebate", async () => {
    // If a future refactor accidentally normalized metricValue to a
    // fraction (0-1), this would silently zero out every contract's
    // compliance/market-share rebate. The test guards against that
    // regression.
    const r = await recomputeThresholdAccrualForTerm({
      contractId: "c",
      facilityId: "f",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      metric: "complianceRate",
      metricValue: 0.85,
      term: baseTerm,
    })
    expect(r.inserted).toBe(0)
    expect(r.sumEarned).toBe(0)
  })

  it("market_share metric uses the same convention (currentMarketShare percent points)", async () => {
    const r = await recomputeThresholdAccrualForTerm({
      contractId: "c",
      facilityId: "f",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      metric: "currentMarketShare",
      metricValue: 90,
      term: baseTerm,
    })
    expect(r.inserted).toBe(1)
    expect(r.sumEarned).toBe(10_000)
  })
})
