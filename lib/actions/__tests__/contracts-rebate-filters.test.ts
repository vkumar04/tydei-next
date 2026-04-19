/**
 * Tests for the rebate aggregation rules on `getContracts` — the same
 * filters the detail page (`getContract`) applies per CLAUDE.md:
 *
 *   rebateEarned    — sum of Rebate rows where
 *                     startOfYear <= payPeriodEnd <= today (YTD, R5.31)
 *   rebateCollected — sum of Rebate rows where collectionDate != null
 *
 * Regression coverage for Charles R4.3 / R4.4 — the list page used to
 * sum `rebateEarned` / `rebateCollected` without any temporal filter,
 * so it either inflated earned (by counting projections for upcoming
 * periods) or showed collected amounts that hadn't actually been
 * collected yet.
 *
 * R5.31 extends the earned filter to a YTD window so the list column
 * ("Rebate Earned (YTD)") matches the detail header ("Rebates Earned
 * (YTD)") — previously the list was lifetime-past while the detail was
 * YTD, producing divergent numbers whenever a contract had prior-year
 * rebate rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type ContractWithRebates = {
  id: string
  rebates: Array<{
    rebateEarned: number
    rebateCollected: number
    payPeriodEnd: Date | null
    collectionDate: Date | null
  }>
}

let contractRows: ContractWithRebates[] = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(async () => contractRows),
      count: vi.fn(async () => contractRows.length),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  facilityScopeClause: vi.fn(() => ({})),
  contractsOwnedByFacility: vi.fn(() => ({})),
  contractOwnershipWhere: vi.fn((id: string) => ({ id })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T>(v: T) => v,
}))

import { getContracts } from "@/lib/actions/contracts"

describe("getContracts — rebate earned/collected filters (R4.3/R4.4/R5.31)", () => {
  // Pin "today" so tests are deterministic regardless of when they run.
  // With today = 2026-06-15, startOfYear = 2026-01-01.
  const FIXED_NOW = new Date("2026-06-15T12:00:00Z")

  beforeEach(() => {
    contractRows = []
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("earned sums ONLY Rebate rows within the current calendar year and <= today (YTD, R5.31)", async () => {
    const thisYear1 = new Date("2026-01-31") // YTD — counts
    const thisYear2 = new Date("2026-05-31") // YTD — counts
    const lastYear = new Date("2025-12-31") // prior year — excluded
    const future = new Date("2099-12-31") // projection — excluded

    contractRows = [
      {
        id: "c1",
        rebates: [
          { rebateEarned: 1000, rebateCollected: 0, payPeriodEnd: thisYear1, collectionDate: null },
          { rebateEarned: 2500, rebateCollected: 0, payPeriodEnd: thisYear2, collectionDate: null },
          { rebateEarned: 4242, rebateCollected: 0, payPeriodEnd: lastYear, collectionDate: null },
          { rebateEarned: 9999, rebateCollected: 0, payPeriodEnd: future, collectionDate: null },
        ],
      },
    ]

    const result = await getContracts({ facilityId: "fac-test" })
    const c = result.contracts[0] as unknown as { rebateEarned: number; rebateCollected: number }
    expect(c.rebateEarned).toBe(3500) // 1000 + 2500; prior-year + future excluded
    expect(c.rebateCollected).toBe(0) // no collectionDate on any row
  })

  it("excludes a prior-calendar-year rebate row (Charles R5.31 regression)", async () => {
    // Mirrors Charles's $672 case: contract's only rebate was in a prior
    // calendar year. Detail page shows $0 YTD; the list column must agree.
    contractRows = [
      {
        id: "c-charles",
        rebates: [
          {
            rebateEarned: 672,
            rebateCollected: 0,
            payPeriodEnd: new Date("2025-09-30"),
            collectionDate: null,
          },
        ],
      },
    ]
    const result = await getContracts({ facilityId: "fac-test" })
    const c = result.contracts[0] as unknown as { rebateEarned: number }
    expect(c.rebateEarned).toBe(0)
  })

  it("collected sums ONLY Rebate rows where collectionDate is set (semantics unchanged)", async () => {
    const someDate = new Date("2026-03-15")
    const past = new Date("2026-01-31")

    contractRows = [
      {
        id: "c1",
        rebates: [
          // collected with collectionDate — counts
          { rebateEarned: 500, rebateCollected: 500, payPeriodEnd: past, collectionDate: someDate },
          // rebateCollected > 0 but no collectionDate — pending, does NOT count
          { rebateEarned: 750, rebateCollected: 750, payPeriodEnd: past, collectionDate: null },
        ],
      },
    ]

    const result = await getContracts({ facilityId: "fac-test" })
    const c = result.contracts[0] as unknown as { rebateEarned: number; rebateCollected: number }
    expect(c.rebateCollected).toBe(500)
    // Earned still sums both past rows (both fall within YTD)
    expect(c.rebateEarned).toBe(1250)
  })

  it("handles contracts with no rebate rows", async () => {
    contractRows = [{ id: "c1", rebates: [] }]
    const result = await getContracts({ facilityId: "fac-test" })
    const c = result.contracts[0] as unknown as { rebateEarned: number; rebateCollected: number }
    expect(c.rebateEarned).toBe(0)
    expect(c.rebateCollected).toBe(0)
  })
})
