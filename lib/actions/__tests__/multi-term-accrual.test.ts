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
      // W1.K added sumEarned to RecomputeAccrualResult — stub returns 0.
      aggregate: vi.fn().mockResolvedValue({ _sum: { rebateEarned: 0 } }),
      // Charles W1.W-C1: recompute reads collected rows to skip them.
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

// ─── Charles W1.O: cadence-aware Rebate row bucketing ───────────────
//
// The Transactions ledger was rendering monthly rows (~30 days) even
// on contracts whose term `paymentCadence` was `quarterly`. Fix:
// collapse the monthly accrual rows into cadence-sized buckets before
// writing the Rebate table. These tests pin that behavior.
describe("recomputeAccrualForContract — cadence-aware bucketing (Charles W1.O)", () => {
  const baseContract = {
    id: "c-1",
    vendorId: "v-1",
    facilityId: "fac-1",
    contractType: "usage",
    effectiveDate: new Date("2025-01-01T00:00:00Z"),
    expirationDate: new Date("2026-12-31T00:00:00Z"),
  }

  // Charles W1.T — paymentCadence is contract-level now. Term factory
  // drops the cadence field; callers set `paymentCadence` on the contract
  // mock directly.
  const flatTerm = () => ({
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
        rebateValue: 3, // 3% flat
      },
    ],
  })

  it("monthly cadence emits one Rebate row per non-zero month", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      capitalLineItems: [{ paymentCadence: "monthly" }],
      terms: [flatTerm()],
    })
    cogFindManyMock.mockResolvedValue([
      { transactionDate: new Date("2025-01-15T00:00:00Z"), extendedPrice: 10000 },
      { transactionDate: new Date("2025-02-15T00:00:00Z"), extendedPrice: 20000 },
      { transactionDate: new Date("2025-03-15T00:00:00Z"), extendedPrice: 30000 },
    ])

    await recomputeAccrualForContract("c-1")

    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{ rebateEarned: number; payPeriodStart: Date; payPeriodEnd: Date }>
    }
    // Three months of non-zero spend → three rows, each ~30 days.
    expect(args.data).toHaveLength(3)
    for (const row of args.data) {
      const spanDays =
        (row.payPeriodEnd.getTime() - row.payPeriodStart.getTime()) /
        (24 * 60 * 60 * 1000)
      expect(spanDays).toBeLessThan(35)
      expect(spanDays).toBeGreaterThan(27)
    }
  })

  it("quarterly cadence: three non-zero months in same quarter -> ONE row", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      capitalLineItems: [{ paymentCadence: "quarterly" }],
      terms: [flatTerm()],
    })
    cogFindManyMock.mockResolvedValue([
      { transactionDate: new Date("2025-01-15T00:00:00Z"), extendedPrice: 10000 },
      { transactionDate: new Date("2025-02-15T00:00:00Z"), extendedPrice: 20000 },
      { transactionDate: new Date("2025-03-15T00:00:00Z"), extendedPrice: 30000 },
    ])

    await recomputeAccrualForContract("c-1")

    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{
        rebateEarned: number
        payPeriodStart: Date
        payPeriodEnd: Date
        notes: string
      }>
    }
    expect(args.data).toHaveLength(1)
    const q1 = args.data[0]
    // Earned: 3% of ($10k + $20k + $30k) = $1,800.
    expect(q1.rebateEarned).toBeCloseTo(1800, 2)
    // Q1 bounds: Jan 1 -> Mar 31.
    expect(q1.payPeriodStart.toISOString().slice(0, 10)).toBe("2025-01-01")
    expect(q1.payPeriodEnd.toISOString().slice(0, 10)).toBe("2025-03-31")
    // Notes should mention the quarter label and the summed spend.
    expect(q1.notes).toMatch(/Q1 2025/)
    expect(q1.notes).toMatch(/\$60000\.00/)
  })

  it("quarterly cadence spanning 2 quarters -> 2 rows", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      capitalLineItems: [{ paymentCadence: "quarterly" }],
      terms: [flatTerm()],
    })
    cogFindManyMock.mockResolvedValue([
      { transactionDate: new Date("2025-02-15T00:00:00Z"), extendedPrice: 10000 }, // Q1
      { transactionDate: new Date("2025-05-15T00:00:00Z"), extendedPrice: 20000 }, // Q2
    ])

    await recomputeAccrualForContract("c-1")

    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{ rebateEarned: number; payPeriodStart: Date; notes: string }>
    }
    expect(args.data).toHaveLength(2)
    const q1 = args.data.find((r) => r.notes.includes("Q1 2025"))
    const q2 = args.data.find((r) => r.notes.includes("Q2 2025"))
    expect(q1).toBeDefined()
    expect(q2).toBeDefined()
    expect(q1!.rebateEarned).toBeCloseTo(300, 2) // 3% of $10k
    expect(q2!.rebateEarned).toBeCloseTo(600, 2) // 3% of $20k
  })

  it("annual cadence: 12 non-zero months -> ONE row per year", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      capitalLineItems: [{ paymentCadence: "annual" }],
      terms: [flatTerm()],
    })
    const cog: Array<{ transactionDate: Date; extendedPrice: number }> = []
    for (let m = 0; m < 12; m++) {
      cog.push({
        transactionDate: new Date(Date.UTC(2025, m, 15)),
        extendedPrice: 1000,
      })
    }
    cogFindManyMock.mockResolvedValue(cog)

    await recomputeAccrualForContract("c-1")

    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{ rebateEarned: number; payPeriodStart: Date; payPeriodEnd: Date }>
    }
    expect(args.data).toHaveLength(1)
    const year = args.data[0]
    // 3% of $12,000 = $360.
    expect(year.rebateEarned).toBeCloseTo(360, 2)
    expect(year.payPeriodStart.toISOString().slice(0, 10)).toBe("2025-01-01")
    expect(year.payPeriodEnd.toISOString().slice(0, 10)).toBe("2025-12-31")
  })

  it("missing paymentCadence defaults to monthly", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          // No paymentCadence field at all.
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
      { transactionDate: new Date("2025-01-15T00:00:00Z"), extendedPrice: 10000 },
      { transactionDate: new Date("2025-02-15T00:00:00Z"), extendedPrice: 20000 },
    ])

    await recomputeAccrualForContract("c-1")

    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<unknown>
    }
    // Two non-zero months, monthly cadence fallback -> two rows.
    expect(args.data).toHaveLength(2)
  })
})
