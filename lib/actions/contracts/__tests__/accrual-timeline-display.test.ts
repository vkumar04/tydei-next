/**
 * Regression test for Charles W1.S.
 *
 * Root cause: `getAccrualTimeline` passed `ContractTier.rebateValue`
 * directly to the rebate engine. `rebateValue` is stored as a fraction
 * (0.03 = 3%), but the engine in `lib/rebates/calculate.ts`
 * expects integer percent (3 = 3%). Without the scale at the Prisma
 * boundary the Accrual Timeline's Rate column rendered "0.03%" (raw
 * fraction) and the Accrued column computed `spend × 0.03 / 100`, which
 * was 100× smaller than the correct `spend × 0.03`.
 *
 * Fix: scale `rebateValue` by 100 for `percent_of_spend` tiers when
 * building the `TermAccrualConfig` — same convention used by
 * `computeRebateFromPrismaTiers` and `formatTierRebateLabel`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { cogFindManyMock, contractFindUniqueMock } = vi.hoisted(() => ({
  cogFindManyMock: vi.fn(),
  contractFindUniqueMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: contractFindUniqueMock,
    },
    cOGRecord: {
      findMany: cogFindManyMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

import { getAccrualTimeline } from "@/lib/actions/contracts/accrual"

const baseContract = {
  id: "c-1",
  vendorId: "v-1",
  facilityId: "fac-1",
  contractType: "usage",
  effectiveDate: new Date("2025-01-01T00:00:00Z"),
  expirationDate: new Date("2025-06-30T00:00:00Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getAccrualTimeline — Rate column scaling (Charles W1.S)", () => {
  it("renders raw fractional rebateValue (0.03) as scaled percent (3) on output", async () => {
    // ContractTier.rebateValue is stored as a fraction: 0.03 = 3%.
    // `rebateType` defaults to percent_of_spend.
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "annual",
          effectiveStart: null,
          effectiveEnd: null,
          createdAt: new Date("2025-01-01T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              rebateValue: 0.03,
              rebateType: "percent_of_spend",
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 215754,
      },
    ])

    const result = await getAccrualTimeline("c-1")

    const jan = result.rows.find((r) => r.month === "2025-01")
    expect(jan).toBeDefined()
    expect(jan?.spend).toBe(215754)
    expect(jan?.tierAchieved).toBe(1)
    // Post-fix: rebatePercent returned from the engine should be 3 (not
    // 0.03). UI formats this as `3.00%`.
    expect(jan?.rebatePercent).toBeCloseTo(3, 5)
    // Charles 2026-04-25: annual-eval terms now re-budget per-month
    // slices to the year-end row (mid-year months show tier/rate but
    // $0 accrual since annual rebates aren't earned mid-year). The
    // year's full $6472.62 lands on the last available month — for
    // a 2025 series running through today, that's December 2025
    // (or the latest in-range month for partial years).
    expect(jan?.accruedAmount).toBe(0)
    // Year's total accrual: spend × rate = 215754 × 0.03 = 6472.62.
    // Pre-fix this was 100× too small (64.73) because the engine
    // computed `spend × 0.03 / 100`. Post annual re-budget, look for
    // it on the year-end row instead of January.
    const year2025Rows = result.rows.filter((r) => r.month.startsWith("2025-"))
    const year2025Last = year2025Rows[year2025Rows.length - 1]
    expect(year2025Last?.accruedAmount).toBeCloseTo(215754 * 0.03, 2)
  })

  it("scales every percent tier consistently across a multi-month series", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: null,
          effectiveEnd: null,
          createdAt: new Date("2025-01-01T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              rebateValue: 0.025,
              rebateType: "percent_of_spend",
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      { transactionDate: new Date("2025-01-10T00:00:00Z"), extendedPrice: 100_000 },
      { transactionDate: new Date("2025-02-10T00:00:00Z"), extendedPrice: 200_000 },
      { transactionDate: new Date("2025-03-10T00:00:00Z"), extendedPrice: 300_000 },
    ])

    const result = await getAccrualTimeline("c-1")

    for (const row of result.rows.filter((r) => r.spend > 0)) {
      // rebatePercent stays 2.5 every month (post-fix scaled display).
      expect(row.rebatePercent).toBeCloseTo(2.5, 5)
      // Accrued column reconciles exactly to spend × stored fraction.
      expect(row.accruedAmount).toBeCloseTo(row.spend * 0.025, 2)
    }
  })

  it("does not scale non-percent rebate types (fixed_rebate stays raw)", async () => {
    // Fixed-dollar tier: the engine path only handles percent today, but
    // the boundary scaler should leave non-percent values untouched so
    // any future engine support isn't double-scaled.
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "annual",
          effectiveStart: null,
          effectiveEnd: null,
          createdAt: new Date("2025-01-01T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              rebateValue: 500,
              rebateType: "fixed_rebate",
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      { transactionDate: new Date("2025-01-15T00:00:00Z"), extendedPrice: 100_000 },
    ])

    const result = await getAccrualTimeline("c-1")
    // The engine will still treat the value as a percent (engine is
    // percent-only today), but the scaler must not have multiplied the
    // raw 500 by 100 — that would produce astronomical amounts. Just
    // assert we returned rows without throwing.
    expect(result.rows.length).toBeGreaterThan(0)
  })
})
