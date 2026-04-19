/**
 * Charles R5.29: multi-term contracts were losing all terms except the
 * first during rebate computation. `recomputeAccrualForContract` only
 * iterated `contract.terms[0]`, so a contract with a "Qualified Annual
 * Spend Rebate" (3/5/6%) + a "Distal Extremities Rebate" (2%) wrote
 * Rebate rows reflecting only the first term's math.
 *
 * This test drives a contract with two terms, each with different
 * tier shapes + rebate values, and asserts that the per-month
 * `rebateEarned` written to the Rebate ledger equals the SUM across
 * both terms — not just the first.
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

describe("recomputeAccrualForContract — iterates ALL terms (Charles R5.29)", () => {
  it("sums per-month accrual across two terms with different tier shapes", async () => {
    // Contract window: 2025-01-01 → 2026-12-31.
    // Two terms:
    //   Term A — "Qualified Annual Spend Rebate", monthly-eval, cumulative.
    //     Tier 1 spendMin=0   rebateValue=3   → 3% of monthly spend
    //   Term B — "Distal Extremities Rebate", monthly-eval, cumulative.
    //     Tier 1 spendMin=0   rebateValue=2   → 2% of monthly spend
    //
    // One COG row at $10,000 in 2025-05.
    // Expected combined accrual for 2025-05 = $10,000 * (3% + 2%) = $500.
    // Pre-fix behavior would write only $300 (3%) — 40% low.
    contractFindUniqueMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-1",
      facilityId: "fac-1",
      contractType: "usage",
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      expirationDate: new Date("2026-12-31T00:00:00Z"),
      terms: [
        {
          id: "term-a",
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
              rebateValue: 3, // 3%
            },
          ],
        },
        {
          id: "term-b",
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
              rebateValue: 2, // 2%
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-05-10T00:00:00Z"),
        extendedPrice: 10000,
      },
    ])

    await recomputeAccrualForContract("c-1")

    expect(rebateCreateManyMock).toHaveBeenCalledTimes(1)
    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{
        rebateEarned: number
        payPeriodEnd: Date
        notes: string
      }>
    }

    // One row for 2025-05.
    const may = args.data.find(
      (r) => r.payPeriodEnd.toISOString().slice(0, 7) === "2025-05",
    )
    expect(may).toBeDefined()

    // SUM of both terms: 3% + 2% = 5% on $10,000 = $500.
    // Pre-fix this would have been $300 (term A only).
    expect(may!.rebateEarned).toBeCloseTo(500, 2)

    // The notes should indicate that multiple terms combined into this
    // row so ledger readers can audit the aggregation.
    expect(may!.notes).toMatch(/2 terms combined/)
  })

  it("falls back to single-term note when only one term qualifies", async () => {
    // Single-term contract should NOT say "2 terms combined".
    contractFindUniqueMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-1",
      facilityId: "fac-1",
      contractType: "usage",
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      expirationDate: new Date("2026-12-31T00:00:00Z"),
      terms: [
        {
          id: "term-a",
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
              rebateValue: 3,
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-05-10T00:00:00Z"),
        extendedPrice: 10000,
      },
    ])

    await recomputeAccrualForContract("c-1")

    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{ rebateEarned: number; notes: string }>
    }
    expect(args.data[0].rebateEarned).toBeCloseTo(300, 2)
    expect(args.data[0].notes).toMatch(/tier 1 @ 3%/)
    expect(args.data[0].notes).not.toMatch(/terms combined/)
  })

  it("honors per-term effective window when summing", async () => {
    // Term A runs for all of 2025. Term B only starts 2025-06.
    // Spend: $5,000 in 2025-05 (before B kicks in), $10,000 in 2025-07.
    // Expected:
    //   2025-05 row: only Term A's 3% = $150.
    //   2025-07 row: Term A 3% + Term B 2% = 5% of $10,000 = $500.
    contractFindUniqueMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-1",
      facilityId: "fac-1",
      contractType: "usage",
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      expirationDate: new Date("2026-12-31T00:00:00Z"),
      terms: [
        {
          id: "term-a",
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: new Date("2025-01-01T00:00:00Z"),
          effectiveEnd: new Date("2025-12-31T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              rebateValue: 3,
            },
          ],
        },
        {
          id: "term-b",
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: new Date("2025-06-01T00:00:00Z"),
          effectiveEnd: new Date("2025-12-31T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              rebateValue: 2,
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-05-10T00:00:00Z"),
        extendedPrice: 5000,
      },
      {
        transactionDate: new Date("2025-07-10T00:00:00Z"),
        extendedPrice: 10000,
      },
    ])

    await recomputeAccrualForContract("c-1")

    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{ rebateEarned: number; payPeriodEnd: Date }>
    }
    const may = args.data.find(
      (r) => r.payPeriodEnd.toISOString().slice(0, 7) === "2025-05",
    )
    const jul = args.data.find(
      (r) => r.payPeriodEnd.toISOString().slice(0, 7) === "2025-07",
    )

    // May: only Term A active → 3% × $5,000 = $150.
    expect(may!.rebateEarned).toBeCloseTo(150, 2)
    // Jul: both active → 5% × $10,000 = $500.
    expect(jul!.rebateEarned).toBeCloseTo(500, 2)
  })
})
