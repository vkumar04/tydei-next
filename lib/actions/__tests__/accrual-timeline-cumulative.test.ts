/**
 * Charles W1.X-B — Accrual Timeline cumulative column.
 *
 * Pins the "Cumulative" column semantics on two surfaces:
 *
 *   1. The pure builder `buildMonthlyAccruals` in `lib/contracts/accrual.ts`
 *      already computes a running cumulative correctly — these cases lock
 *      that contract in so a future refactor can't regress it.
 *   2. The server action `getAccrualTimeline` in
 *      `lib/actions/contracts/accrual.ts` aggregates per-term rows into
 *      one timeline. Pre-fix, it set `cumulativeSpend = totalSpend` (the
 *      current month's spend), so the Cumulative column mirrored Spend
 *      and zero-spend tail months showed $0. Post-fix, it accumulates
 *      across months so the label "Cumulative" is truthful.
 *
 * If the action-level assertion fails with actual `[100, 0, 50]` vs
 * expected `[100, 100, 150]`, the W1.X-B fix has regressed — chase the
 * `runningCumulative` accumulator in `getAccrualTimeline`, not this test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildMonthlyAccruals } from "@/lib/contracts/accrual"

describe("accrual timeline cumulative column", () => {
  it("carries cumulative forward through zero-spend months", () => {
    const series = [
      { month: "2025-01", spend: 100 },
      { month: "2025-02", spend: 0 },
      { month: "2025-03", spend: 50 },
    ]
    const tiers = [
      { tierNumber: 1, tierName: null, spendMin: 0, spendMax: null, rebateValue: 5 },
    ]
    const rows = buildMonthlyAccruals(series, tiers, "cumulative", "monthly")
    expect(rows.map((r) => r.cumulativeSpend)).toEqual([100, 100, 150])
  })

  it("first month's cumulative equals its spend", () => {
    const series = [{ month: "2025-01", spend: 200 }]
    const tiers = [
      { tierNumber: 1, tierName: null, spendMin: 0, spendMax: null, rebateValue: 3 },
    ]
    const rows = buildMonthlyAccruals(series, tiers, "cumulative", "monthly")
    expect(rows[0].cumulativeSpend).toBe(200)
  })
})

// ─── Action-level wiring test ──────────────────────────────────────────
//
// The shared `tests/helpers/contract-fixtures` module doesn't exist in
// this repo, so per the plan we inline the seed — here using the same
// prisma-mock pattern as `accrual-timeline-category-scope.test.ts`. The
// mock feeds `getAccrualTimeline` three months of spend (Jan $100, Feb
// $0 carried forward, Mar $50) and asserts the running cumulative.

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
  cumulativeSpend: number
  accruedAmount: number
}

type TimelineResult = {
  rows: TimelineRow[]
}

const EFFECTIVE = new Date("2025-01-01T00:00:00Z")
const EXPIRATION = new Date("2025-03-31T00:00:00Z")

// Jan $100, Feb none (zero-spend month), Mar $50.
const COG_ROWS = [
  {
    transactionDate: new Date("2025-01-15T00:00:00Z"),
    extendedPrice: 100,
    category: "Cat A",
  },
  {
    transactionDate: new Date("2025-03-15T00:00:00Z"),
    extendedPrice: 50,
    category: "Cat A",
  },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getAccrualTimeline cumulative column", () => {
  it("returns running cumulative, not per-month spend", async () => {
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
          id: "term-1",
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
              rebateValue: 0.05, // fraction — engine scales at the boundary
              rebateType: "percent_of_spend",
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue(COG_ROWS)

    const result = (await getAccrualTimeline("c-1")) as TimelineResult

    // Before the fix, cumulativeSpend === spend for every row.
    // After the fix, cumulativeSpend is the running sum, carrying
    // forward through the zero-spend February row.
    expect(result.rows.map((r) => r.spend)).toEqual([100, 0, 50])
    expect(result.rows.map((r) => r.cumulativeSpend)).toEqual([100, 100, 150])
  })
})
