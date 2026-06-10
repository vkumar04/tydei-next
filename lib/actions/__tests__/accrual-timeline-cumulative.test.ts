/**
 * Charles W1.X-B + 2026-04-23 refinement — Accrual Timeline Cumulative
 * column semantics.
 *
 * History:
 *   W1.X-B: fixed a bug where `cumulativeSpend` was set to the current
 *   month's spend so zero-spend tail months showed $0 instead of
 *   carrying the running total.
 *   2026-04-23: Charles flagged that for a quarterly-eval contract, the
 *   display carrying a LIFETIME cumulative misleadingly suggests the
 *   tier math uses lifetime spend. The engine already resets at period
 *   boundaries (`windowSpend` in `buildMonthlyAccruals`); the display
 *   now matches — cumulative resets at the same boundaries the engine
 *   uses for tier qualification.
 *
 * Rules (single-term contracts):
 *   monthly    → cumulative = THIS month's spend (resets every month)
 *   quarterly  → resets at each calendar quarter (Jan, Apr, Jul, Oct)
 *   semi-ann.  → resets at H1 (Jan) and H2 (Jul)
 *   annual     → resets at calendar-year start
 *
 * Multi-term contracts keep lifetime cumulative since different terms
 * can run on different cadences.
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
      findFirstOrThrow: contractFindUniqueOrThrowMock,
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
  isPeriodSubtotal?: boolean
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

function seedContract(evaluationPeriod: string) {
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
        evaluationPeriod,
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
}

describe("getAccrualTimeline cumulative column", () => {
  // 2026-06-09 (Charles "quarterly contract showing monthly accrual"): the
  // timeline now ROLLS per-month rows up into evaluation-period buckets, so a
  // quarterly/annual contract shows one row per quarter/year (not per month).
  // The cumulative-reset semantics are preserved: each period row carries that
  // period's total. Monthly eval still shows per-month rows.
  it("annual eval: keeps monthly rows and appends a 2025 subtotal row", async () => {
    // 2026-06-10 (Charles "the monthly data was removed it is just showing
    // cumulative annuals"): the 2026-06-09 rollup collapsed months into one
    // bucket row; now every month stays visible and a bold subtotal row is
    // interleaved at each evaluation-period boundary.
    seedContract("annual")
    const result = (await getAccrualTimeline("c-1")) as TimelineResult
    expect(result.rows.map((r) => r.month)).toEqual([
      "2025-01",
      "2025-02",
      "2025-03",
      "2025",
    ])
    expect(result.rows.map((r) => Boolean(r.isPeriodSubtotal))).toEqual([
      false,
      false,
      false,
      true,
    ])
    const subtotal = result.rows[3]
    expect(subtotal.spend).toBe(150)
    expect(subtotal.cumulativeSpend).toBe(150)
    // Monthly rows keep their own spend so the user sees the detail.
    expect(result.rows.slice(0, 3).map((r) => r.spend)).toEqual([100, 0, 50])
  })

  it("monthly eval: cumulative resets every month (matches tier math)", async () => {
    seedContract("monthly")
    const result = (await getAccrualTimeline("c-1")) as TimelineResult
    expect(result.rows.map((r) => r.spend)).toEqual([100, 0, 50])
    // Each month is its own window — cumulative equals that month's spend.
    expect(result.rows.map((r) => r.cumulativeSpend)).toEqual([100, 0, 50])
  })

  it("quarterly eval: keeps monthly rows and appends a 2025-Q1 subtotal row", async () => {
    seedContract("quarterly")
    const result = (await getAccrualTimeline("c-1")) as TimelineResult
    // Jan/Feb/Mar all live in Q1 2025 → three month rows + the Q1 subtotal.
    expect(result.rows.map((r) => r.month)).toEqual([
      "2025-01",
      "2025-02",
      "2025-03",
      "2025-Q1",
    ])
    const subtotal = result.rows[3]
    expect(subtotal.isPeriodSubtotal).toBe(true)
    expect(subtotal.spend).toBe(150)
    expect(subtotal.cumulativeSpend).toBe(150)
  })
})
