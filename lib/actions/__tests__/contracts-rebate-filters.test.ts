/**
 * Tests for the rebate aggregation rules on `getContracts` — the same
 * filters the detail page (`getContract`) applies per CLAUDE.md:
 *
 *   rebateEarned    — sum of Rebate rows where payPeriodEnd <= today
 *   rebateCollected — sum of Rebate rows where collectionDate != null
 *
 * Regression coverage for Charles R4.3 / R4.4 — the list page used to
 * sum `rebateEarned` / `rebateCollected` without any temporal filter,
 * so it either inflated earned (by counting projections for upcoming
 * periods) or showed collected amounts that hadn't actually been
 * collected yet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

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

describe("getContracts — rebate earned/collected filters (R4.3/R4.4)", () => {
  beforeEach(() => {
    contractRows = []
  })

  it("earned sums ONLY Rebate rows where payPeriodEnd <= today", async () => {
    const past1 = new Date("2025-01-31")
    const past2 = new Date("2025-06-30")
    const future = new Date("2099-12-31") // projection row

    contractRows = [
      {
        id: "c1",
        rebates: [
          { rebateEarned: 1000, rebateCollected: 0, payPeriodEnd: past1, collectionDate: null },
          { rebateEarned: 2500, rebateCollected: 0, payPeriodEnd: past2, collectionDate: null },
          { rebateEarned: 9999, rebateCollected: 0, payPeriodEnd: future, collectionDate: null },
        ],
      },
    ]

    const result = await getContracts({ facilityId: "fac-test" })
    const c = result.contracts[0] as unknown as { rebateEarned: number; rebateCollected: number }
    expect(c.rebateEarned).toBe(3500) // 1000 + 2500; future row excluded
    expect(c.rebateCollected).toBe(0) // no collectionDate on any row
  })

  it("collected sums ONLY Rebate rows where collectionDate is set", async () => {
    const someDate = new Date("2025-03-15")
    const past = new Date("2025-01-31")

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
    // Earned still sums both past rows
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
