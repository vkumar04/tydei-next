/**
 * Regression test for Charles R5.10 / R5.12.
 *
 * Root cause: `getAccrualTimeline` and `recomputeAccrualForContract`
 * bucketed spend by `COGRecord.createdAt` (the DB insertion timestamp)
 * instead of `COGRecord.transactionDate` (the real purchase date).
 *
 * When the demo seed ran on 2026-04-18, every COG row's `createdAt`
 * landed in April 2026, collapsing 24 months of activity into a single
 * month in the accrual timeline (R5.12 "Spend by period and tier
 * achievement not coming up") and emitting a single Rebate row with
 * `payPeriodEnd = 2026-04-30`, which the `payPeriodEnd <= today` filter
 * on the contract detail card then excluded (R5.10 "says no rebate
 * earned").
 *
 * Fix: use `transactionDate` in both queries and when keying `byMonth`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type CogMockArgs = {
  where: {
    facilityId: string
    vendorId: string
    transactionDate?: { gte: Date; lte: Date }
    createdAt?: { gte: Date; lte: Date }
  }
  select: Record<string, boolean>
}

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

import { getAccrualTimeline } from "@/lib/actions/contracts/accrual"
import { recomputeAccrualForContract } from "@/lib/actions/contracts/recompute-accrual"

const contractShape = {
  id: "c-1",
  vendorId: "v-1",
  facilityId: "fac-1",
  contractType: "usage",
  effectiveDate: new Date("2025-04-01T00:00:00Z"),
  expirationDate: new Date("2027-04-01T00:00:00Z"),
  terms: [
    {
      id: "term-1",
      rebateMethod: "cumulative" as const,
      evaluationPeriod: "monthly",
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
}

beforeEach(() => {
  vi.clearAllMocks()
  contractFindUniqueMock.mockResolvedValue(contractShape)
  rebateDeleteManyMock.mockResolvedValue({ count: 0 })
  rebateCreateManyMock.mockResolvedValue({ count: 0 })
})

describe("getAccrualTimeline — bucket by transactionDate, not createdAt", () => {
  it("queries COGRecord by transactionDate (R5.12)", async () => {
    cogFindManyMock.mockResolvedValue([])

    await getAccrualTimeline("c-1")

    expect(cogFindManyMock).toHaveBeenCalledTimes(1)
    const args = cogFindManyMock.mock.calls[0][0] as CogMockArgs
    // The fix: transactionDate filter, not createdAt.
    expect(args.where.transactionDate).toBeDefined()
    expect(args.where.createdAt).toBeUndefined()
    expect(args.select.transactionDate).toBe(true)
    expect(args.select.createdAt).toBeUndefined()
  })

  it("keys monthly buckets by transactionDate (spend spreads across months)", async () => {
    // Three purchases across three months — `createdAt` all on the seed
    // date, but `transactionDate` spread across May / June / July 2025.
    const seedDate = new Date("2026-04-18T20:23:49Z")
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-05-10T00:00:00Z"),
        createdAt: seedDate,
        extendedPrice: 100,
      },
      {
        transactionDate: new Date("2025-06-15T00:00:00Z"),
        createdAt: seedDate,
        extendedPrice: 200,
      },
      {
        transactionDate: new Date("2025-07-20T00:00:00Z"),
        createdAt: seedDate,
        extendedPrice: 300,
      },
    ])

    const result = await getAccrualTimeline("c-1")

    // Before the fix: all 600 landed in April 2026 and every other
    // month was $0. After: May/Jun/Jul 2025 each get their own spend.
    const may = result.rows.find((r) => r.month === "2025-05")
    const jun = result.rows.find((r) => r.month === "2025-06")
    const jul = result.rows.find((r) => r.month === "2025-07")
    expect(may?.spend).toBe(100)
    expect(jun?.spend).toBe(200)
    expect(jul?.spend).toBe(300)
    // The seed month (April 2026) should NOT contain these dollars.
    const apr2026 = result.rows.find((r) => r.month === "2026-04")
    // It may or may not appear in the series window, but if it does it
    // must be zero (no transactionDate landed there).
    if (apr2026) expect(apr2026.spend).toBe(0)
  })
})

describe("recomputeAccrualForContract — bucket by transactionDate (R5.10)", () => {
  it("queries COGRecord by transactionDate", async () => {
    cogFindManyMock.mockResolvedValue([])

    await recomputeAccrualForContract("c-1")

    expect(cogFindManyMock).toHaveBeenCalledTimes(1)
    const args = cogFindManyMock.mock.calls[0][0] as CogMockArgs
    expect(args.where.transactionDate).toBeDefined()
    expect(args.where.createdAt).toBeUndefined()
  })

  it("generates Rebate rows with payPeriodEnd derived from transactionDate months", async () => {
    const seedDate = new Date("2026-04-18T20:23:49Z")
    cogFindManyMock.mockResolvedValue([
      // Three purchases spread across three real months, all inserted
      // on the same seed date (pre-fix this collapsed to one row).
      {
        transactionDate: new Date("2025-05-10T00:00:00Z"),
        createdAt: seedDate,
        extendedPrice: 10000,
      },
      {
        transactionDate: new Date("2025-06-15T00:00:00Z"),
        createdAt: seedDate,
        extendedPrice: 20000,
      },
      {
        transactionDate: new Date("2025-07-20T00:00:00Z"),
        createdAt: seedDate,
        extendedPrice: 30000,
      },
    ])

    await recomputeAccrualForContract("c-1")

    // Exactly one createMany call with one row per spend-bearing month.
    expect(rebateCreateManyMock).toHaveBeenCalledTimes(1)
    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{
        rebateEarned: number
        payPeriodStart: Date
        payPeriodEnd: Date
      }>
    }
    const months = args.data.map((r) =>
      r.payPeriodEnd.toISOString().slice(0, 7),
    )
    expect(months).toContain("2025-05")
    expect(months).toContain("2025-06")
    expect(months).toContain("2025-07")
    // Crucially, NO row should land in the seed month (2026-04) just
    // because createdAt=2026-04-18. That was the R5.10 bug: the one
    // row had payPeriodEnd=2026-04-30 > today, so the CLAUDE.md filter
    // `payPeriodEnd <= today` excluded it → "no rebate earned".
    expect(months).not.toContain("2026-04")
  })
})
