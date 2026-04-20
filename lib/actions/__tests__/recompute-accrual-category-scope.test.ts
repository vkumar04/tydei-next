/**
 * Charles W1.U-A regression: a term scoped to `appliesTo:
 * "specific_category"` + `categories: ["Cat A"]` must only consider COG
 * rows whose `category` is in that list. Pre-fix, the recompute engine
 * summed the vendor's entire spend across all categories, then applied
 * the single term's tier math — inflating rebates on the list and
 * detail views.
 *
 * Scenario: vendor spent $30K total — $10K in "Cat A", $10K in "Cat B",
 * $10K in "Cat C", all in May 2025. Contract has ONE term scoped to
 * `["Cat A"]` with a single tier at spendMin=$5K @ 3%. Expected:
 *
 *   earned = 3% × $10K (Cat A only) = $300
 *
 * Pre-fix behavior would have written 3% × $30K = $900 (tier crosses
 * the $5K floor anyway, but Cat A alone already qualifies so the tier
 * gate is moot here — what matters is the per-category slice).
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

describe("recomputeAccrualForContract — category-scoped term (Charles W1.U-A)", () => {
  it("earns only on the term's scoped categories, not all vendor spend", async () => {
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
          id: "term-a",
          appliesTo: "specific_category",
          categories: ["Cat A"],
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: new Date("2025-01-01T00:00:00Z"),
          effectiveEnd: new Date("2026-12-31T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 5000,
              spendMax: null,
              rebateValue: 3, // 3%
            },
          ],
        },
      ],
    })

    // The findMany mock ignores the `where` clause: return every row and
    // trust the in-memory category filter to scope them correctly.
    // (This also matches how Prisma mocks usually ignore the where arg.)
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-05-10T00:00:00Z"),
        extendedPrice: 10000,
        category: "Cat A",
      },
      {
        transactionDate: new Date("2025-05-11T00:00:00Z"),
        extendedPrice: 10000,
        category: "Cat B",
      },
      {
        transactionDate: new Date("2025-05-12T00:00:00Z"),
        extendedPrice: 10000,
        category: "Cat C",
      },
    ])

    await recomputeAccrualForContract("c-1")

    // The COG query should have received a category filter matching
    // the term's `categories` list — that's how the DB-side narrowing
    // works in production. Verify the where arg carries it.
    expect(cogFindManyMock).toHaveBeenCalledTimes(1)
    const findArgs = cogFindManyMock.mock.calls[0][0] as {
      where: {
        category?: { in: string[] }
        [k: string]: unknown
      }
    }
    expect(findArgs.where.category).toEqual({ in: ["Cat A"] })

    // Only one row written (May 2025).
    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{
        rebateEarned: number
        payPeriodEnd: Date
        notes: string
      }>
    }
    expect(args.data).toHaveLength(1)
    const may = args.data[0]
    expect(may.payPeriodEnd.toISOString().slice(0, 7)).toBe("2025-05")

    // Pre-fix: vendor-wide $30K × 3% = $900 (wrong).
    // Post-fix: Cat A only $10K × 3% = $300.
    expect(may.rebateEarned).toBeCloseTo(300, 2)
    // Should NEVER compute $900 again.
    expect(may.rebateEarned).not.toBeCloseTo(900, 2)
  })

  it("two terms with DIFFERENT category scopes earn on disjoint slices", async () => {
    // Term A scoped to ["Cat A"] @ 3%, Term B scoped to ["Cat B"] @ 5%.
    // Spend: $10K each in Cat A, Cat B, Cat C in May 2025.
    // Expected: A earns 3% × $10K = $300, B earns 5% × $10K = $500.
    // Combined row total = $800.
    // Pre-fix (single union spend fed to both): both terms would see
    // $30K each → A: 3% × $30K = $900, B: 5% × $30K = $1,500 = $2,400.
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
          id: "term-a",
          appliesTo: "specific_category",
          categories: ["Cat A"],
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
        {
          id: "term-b",
          appliesTo: "specific_category",
          categories: ["Cat B"],
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
              rebateValue: 5,
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-05-01T00:00:00Z"),
        extendedPrice: 10000,
        category: "Cat A",
      },
      {
        transactionDate: new Date("2025-05-02T00:00:00Z"),
        extendedPrice: 10000,
        category: "Cat B",
      },
      {
        transactionDate: new Date("2025-05-03T00:00:00Z"),
        extendedPrice: 10000,
        category: "Cat C",
      },
    ])

    await recomputeAccrualForContract("c-1")

    // The outer query should union both terms' categories.
    const findArgs = cogFindManyMock.mock.calls[0][0] as {
      where: { category?: { in: string[] } }
    }
    expect(findArgs.where.category?.in).toEqual(
      expect.arrayContaining(["Cat A", "Cat B"]),
    )

    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{ rebateEarned: number; notes: string }>
    }
    expect(args.data).toHaveLength(1)
    // Post-fix: $300 (A) + $500 (B) = $800.
    expect(args.data[0].rebateEarned).toBeCloseTo(800, 2)
    expect(args.data[0].notes).toMatch(/2 terms combined/)
  })

  it("all-products term ignores categories + sees full vendor spend", async () => {
    // Regression guard: a plain `all_products` term should match
    // pre-W1.U behavior exactly — no category filtering applied.
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
          id: "term-a",
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
              rebateValue: 3,
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-05-01T00:00:00Z"),
        extendedPrice: 10000,
        category: "Cat A",
      },
      {
        transactionDate: new Date("2025-05-02T00:00:00Z"),
        extendedPrice: 10000,
        category: "Cat B",
      },
    ])

    await recomputeAccrualForContract("c-1")

    const findArgs = cogFindManyMock.mock.calls[0][0] as {
      where: { category?: { in: string[] } }
    }
    // No category filter on an all-products term.
    expect(findArgs.where.category).toBeUndefined()

    const args = rebateCreateManyMock.mock.calls[0][0] as {
      data: Array<{ rebateEarned: number }>
    }
    // 3% × $20K = $600.
    expect(args.data[0].rebateEarned).toBeCloseTo(600, 2)
  })
})
