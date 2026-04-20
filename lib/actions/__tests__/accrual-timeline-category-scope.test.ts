/**
 * Retro B3: lock down the category-scope behavior on the
 * `getAccrualTimeline` read path.
 *
 * Charles W1.U-A (commit 1bcb2dd) fixed a bug where the rebate-accrual
 * read paths all ignored `ContractTerm.appliesTo` + `categories`, so a
 * term scoped to ["Cat A"] saw the vendor's entire spend across every
 * category. The write path (`recomputeAccrualForContract`) is covered by
 * `recompute-accrual-category-scope.test.ts`. This file is the
 * equivalent regression for `getAccrualTimeline`, which drives the
 * contract-detail Performance tab timeline and must agree numerically
 * with the persisted Rebate ledger.
 *
 * Fixture shape mirrors the write-path test:
 *   - One contract effective 2025-01-01 → 2026-12-31, vendorId v-1.
 *   - May 2025 COG: $10K Cat A, $10K Cat B, $10K Cat C.
 *   - Term A: appliesTo="specific_category", categories=["Cat A"],
 *     tier 3% at spendMin=$5K → expected accrued $300 (NOT $900).
 *
 * A second assertion exercises the regression guard: an `all_products`
 * term must see the full $30K vendor-wide spend (= $900 at 3%).
 *
 * If either assertion fails, the W1.U-A fix has regressed on the read
 * path (the helper call was lost from `getAccrualTimeline`). Don't
 * "fix" this test by loosening the assertion — chase the read-site
 * instead. See `lib/contracts/cog-category-filter.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { cogFindManyMock, contractFindUniqueOrThrowMock } = vi.hoisted(() => ({
  cogFindManyMock: vi.fn(),
  contractFindUniqueOrThrowMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: contractFindUniqueOrThrowMock,
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

type TimelineRow = {
  month: string
  spend: number
  accruedAmount: number
}

type TimelineResult = {
  rows: TimelineRow[]
}

const EFFECTIVE = new Date("2025-01-01T00:00:00Z")
const EXPIRATION = new Date("2026-12-31T00:00:00Z")

const COG_ROWS = [
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
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getAccrualTimeline — category-scoped term (Charles W1.U-A read path)", () => {
  it("earns only on the term's scoped categories, not all vendor spend", async () => {
    contractFindUniqueOrThrowMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-1",
      facilityId: "fac-1",
      contractType: "usage",
      effectiveDate: EFFECTIVE,
      expirationDate: EXPIRATION,
      paymentCadence: "monthly",
      terms: [
        {
          id: "term-a",
          appliesTo: "specific_category",
          categories: ["Cat A"],
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: EFFECTIVE,
          effectiveEnd: EXPIRATION,
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 5000,
              spendMax: null,
              rebateValue: 0.03, // fraction — engine scales at the boundary
              rebateType: "percent_of_spend",
            },
          ],
        },
      ],
    })

    // Mock ignores the where arg — the in-memory partition below enforces
    // category scope. The test then asserts that the where arg still
    // carries the category filter so the DB narrowing is preserved.
    cogFindManyMock.mockResolvedValue(COG_ROWS)

    const result = (await getAccrualTimeline("c-1")) as TimelineResult

    // The findMany call should carry a category pre-filter matching
    // the term's `categories` (union helper returns the same list for
    // a single-term contract).
    expect(cogFindManyMock).toHaveBeenCalledTimes(1)
    const findArgs = cogFindManyMock.mock.calls[0][0] as {
      where: {
        category?: { in: string[] }
        vendorId?: string
        facilityId?: string
      }
    }
    expect(findArgs.where.category).toEqual({ in: ["Cat A"] })
    expect(findArgs.where.vendorId).toBe("v-1")

    // Locate the May 2025 row — the only month with COG spend.
    const may = result.rows.find((r) => r.month === "2025-05")
    expect(may, "expected a 2025-05 timeline row").toBeTruthy()
    if (!may) return

    // Post-fix: Cat A only $10K × 3% = $300.
    // Pre-fix: vendor-wide $30K × 3% = $900.
    expect(may.spend).toBeCloseTo(10000, 2)
    expect(may.accruedAmount).toBeCloseTo(300, 2)
    expect(may.accruedAmount).not.toBeCloseTo(900, 2)
  })

  it("all-products term sees the full vendor-wide spend ($30K × 3% = $900)", async () => {
    contractFindUniqueOrThrowMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-1",
      facilityId: "fac-1",
      contractType: "usage",
      effectiveDate: EFFECTIVE,
      expirationDate: EXPIRATION,
      paymentCadence: "monthly",
      terms: [
        {
          id: "term-a",
          appliesTo: "all_products",
          categories: [],
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: EFFECTIVE,
          effectiveEnd: EXPIRATION,
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

    cogFindManyMock.mockResolvedValue(COG_ROWS)

    const result = (await getAccrualTimeline("c-1")) as TimelineResult

    // On an all-products term the union-helper returns {} so no
    // `category` fragment should appear in the findMany where.
    const findArgs = cogFindManyMock.mock.calls[0][0] as {
      where: { category?: { in: string[] } }
    }
    expect(findArgs.where.category).toBeUndefined()

    const may = result.rows.find((r) => r.month === "2025-05")
    expect(may, "expected a 2025-05 timeline row").toBeTruthy()
    if (!may) return

    // $30K total × 3% = $900.
    expect(may.spend).toBeCloseTo(30000, 2)
    expect(may.accruedAmount).toBeCloseTo(900, 2)
  })
})
