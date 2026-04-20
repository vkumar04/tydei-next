/**
 * Charles W1.V regression: `recomputeAccrualForContract` must scale
 * `ContractTier.rebateValue` from fraction storage (0.03) to integer
 * percent (3) before feeding the rebate engine. W1.S fixed this boundary
 * for the DISPLAY path (`getAccrualTimeline`) but left the PERSISTENCE
 * path (this action) broken — every Rebate row written was 100× too
 * small.
 *
 * Scenario: one term with `rebateValue = 0.03` (3% stored as fraction,
 * `rebateType = "percent_of_spend"`), vendor spent exactly $10,000 in
 * May 2025. Expected persisted `rebateEarned = $300` (3% × $10K).
 *
 * Pre-fix this would have written $3 (Number(0.03) fed raw to the
 * engine → (10000 × 0.03) / 100 = 3).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  cogFindManyMock,
  rebateDeleteManyMock,
  rebateCreateManyMock,
  contractFindUniqueMock,
} = vi.hoisted(() => ({
  cogFindManyMock: vi.fn(),
  rebateDeleteManyMock: vi.fn(),
  rebateCreateManyMock: vi.fn(),
  contractFindUniqueMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: contractFindUniqueMock,
      findUnique: contractFindUniqueMock,
    },
    cOGRecord: {
      findMany: cogFindManyMock,
    },
    rebate: {
      deleteMany: rebateDeleteManyMock,
      createMany: rebateCreateManyMock,
      aggregate: vi.fn().mockResolvedValue({ _sum: { rebateEarned: 0 } }),
      // Charles W1.W-C1: recompute now reads collected rows to skip
      // their periods. Default to empty so this test's buckets all
      // insert as before.
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

import { recomputeAccrualForContract } from "@/lib/actions/contracts/recompute-accrual"

beforeEach(() => {
  vi.clearAllMocks()
  rebateDeleteManyMock.mockResolvedValue({ count: 0 })
  rebateCreateManyMock.mockResolvedValue({ count: 0 })
})

describe("recomputeAccrualForContract — rebateValue unit scaling (Charles W1.V)", () => {
  it("scales a `percent_of_spend` rebateValue stored as 0.03 to 3% at the engine boundary", async () => {
    contractFindUniqueMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-1",
      facilityId: "fac-1",
      contractType: "usage",
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      expirationDate: new Date("2026-12-31T00:00:00Z"),
      paymentCadence: "monthly",
      terms: [
        {
          id: "term-1",
          appliesTo: "all_products",
          categories: [],
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: new Date("2025-01-01T00:00:00Z"),
          effectiveEnd: new Date("2026-12-31T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              // 3% stored as a fraction (the real Prisma shape).
              rebateValue: 0.03,
              rebateType: "percent_of_spend" as const,
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-05-10T00:00:00Z"),
        extendedPrice: 10000,
        category: "Cat A",
      },
    ])

    await recomputeAccrualForContract("c-1")

    expect(rebateCreateManyMock).toHaveBeenCalledTimes(1)
    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{
        rebateEarned: number
        payPeriodEnd: Date
      }>
    }
    expect(args.data).toHaveLength(1)

    // Post-fix: 3% × $10K = $300.
    expect(args.data[0].rebateEarned).toBeCloseTo(300, 2)

    // Pre-fix bug wrote $3 (Number(0.03) passed straight to the engine).
    // Guard so a future regression never silently re-introduces it.
    expect(args.data[0].rebateEarned).not.toBeCloseTo(3, 2)
  })

  it("does NOT scale non-percent rebate types (fixed_rebate stays as-is)", async () => {
    // Regression guard: fixed_rebate tiers store raw dollar amounts, not
    // fractions. Scaling them would turn $5,000 into $500,000.
    contractFindUniqueMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-1",
      facilityId: "fac-1",
      contractType: "usage",
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      expirationDate: new Date("2026-12-31T00:00:00Z"),
      paymentCadence: "monthly",
      terms: [
        {
          id: "term-1",
          appliesTo: "all_products",
          categories: [],
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: new Date("2025-01-01T00:00:00Z"),
          effectiveEnd: new Date("2026-12-31T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              rebateValue: 5000,
              rebateType: "fixed_rebate" as const,
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-05-10T00:00:00Z"),
        extendedPrice: 10000,
        category: "Cat A",
      },
    ])

    await recomputeAccrualForContract("c-1")

    // The accrual engine in this code path treats the tier's rebateValue
    // as an integer-percent rate regardless of rebateType — so with
    // rebateValue=5000, yield = (10000 × 5000) / 100 = $500,000. That's
    // a pre-existing engine limitation we're not fixing here; what this
    // test guards against is DOUBLE scaling (5000 × 100 → 500,000 → math
    // → $50,000,000). The scaler must be a no-op for non-percent types.
    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{ rebateEarned: number }>
    }
    expect(args.data[0].rebateEarned).toBeLessThan(1_000_000)
  })
})
