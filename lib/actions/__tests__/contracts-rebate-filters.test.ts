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
  vendorId?: string
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
    // Charles W1.J — `getContracts` now batches trailing-12mo spend
    // aggregations to populate the SPEND column. Tests in this file
    // don't exercise currentSpend; stub the groupBy calls as empty so
    // the rebate-focused assertions still pass.
    contractPeriod: {
      groupBy: vi.fn(async () => []),
    },
    cOGRecord: {
      groupBy: vi.fn(async () => []),
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

  it("earned sums every closed Rebate row (Lifetime, Charles iMessage 2026-04-20 N13)", async () => {
    // N13 changed the list's rebateEarned from YTD → Lifetime. Any Rebate
    // whose payPeriodEnd <= today counts, including prior calendar years.
    // Future periods remain excluded (they're projections, not earned).
    // Clock: FIXED_NOW = 2026-06-15
    const thisYear1 = new Date("2026-01-31") // closed — counts
    const thisYear2 = new Date("2026-05-31") // closed — counts
    const lastYear = new Date("2025-12-31") // closed prior year — counts (Lifetime, not YTD)
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
    // 1000 (Jan 2026, closed) + 2500 (May 2026, closed) + 4242 (Dec 2025,
    // closed prior year — now counted under Lifetime) = 7742. Future 2099
    // row excluded.
    expect(c.rebateEarned).toBe(7742)
    expect(c.rebateCollected).toBe(0) // no collectionDate on any row
  })

  it("counts prior-calendar-year rebate rows under Lifetime (Charles iMessage 2026-04-20 N13)", async () => {
    // Inverts R5.31's YTD rule: Charles's $672 case had its only Rebate
    // row in a prior calendar year. Under the pre-N13 YTD semantics the
    // list showed $0 to match the detail's YTD card. N13 moved the list
    // to Lifetime — the contract detail still has its YTD card for
    // compliance, but the list column now surfaces the whole-contract
    // earned number so small contracts with seasonal rebates don't look
    // empty. The $672 IS real earned rebate from a closed period.
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
    expect(c.rebateEarned).toBe(672)
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
