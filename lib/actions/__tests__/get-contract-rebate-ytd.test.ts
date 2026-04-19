/**
 * Regression tests for `getContract` rebate scope split (Charles R5.27).
 *
 * Feedback: "What is the difference between Total Rebates and Rebates Earned?
 * I think they are the same." They were: both used the same
 * `payPeriodEnd <= today` filter. Fix: `getContract` now returns two fields:
 *
 *   - `rebateEarned`    — lifetime closed-period earnings (unchanged)
 *   - `rebateEarnedYTD` — closed-period earnings within current calendar year
 *
 * The contract detail header card shows YTD (labeled "Rebates Earned (YTD)");
 * the Transactions tab card shows lifetime (labeled "Total Rebates (Lifetime)").
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type RebateRow = {
  id: string
  rebateEarned: number
  rebateCollected: number
  payPeriodEnd: Date | null
  collectionDate: Date | null
}

type ContractShape = {
  id: string
  vendorId: string
  totalValue: number
  facilityId: string
  rebates: RebateRow[]
  periods: Array<{ id: string }>
}

let contractRow: ContractShape | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: vi.fn(async () => {
        if (!contractRow) throw new Error("not found")
        return contractRow
      }),
    },
    contractPeriod: {
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _sum: { totalSpend: 0 } })),
    },
    cOGRecord: {
      aggregate: vi.fn(async () => ({ _sum: { extendedPrice: 0 } })),
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
  contractOwnershipWhere: vi.fn((id: string, _fid: string) => ({ id })),
  contractsOwnedByFacility: vi.fn(() => ({})),
  facilityScopeClause: vi.fn(() => ({})),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

import { getContract } from "@/lib/actions/contracts"

function makeContract(overrides: Partial<ContractShape> = {}): ContractShape {
  return {
    id: "c-1",
    vendorId: "v-1",
    totalValue: 100000,
    facilityId: "fac-test",
    rebates: [],
    periods: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  contractRow = null
})

describe("getContract — rebate scope split (Charles R5.27)", () => {
  it("returns both rebateEarned (lifetime) and rebateEarnedYTD (calendar year)", async () => {
    const today = new Date()
    const thisYear = today.getFullYear()
    const lastYear = thisYear - 1

    contractRow = makeContract({
      rebates: [
        {
          id: "r-prior-year",
          rebateEarned: 5000,
          rebateCollected: 0,
          payPeriodEnd: new Date(lastYear, 5, 30),
          collectionDate: null,
        },
        {
          id: "r-ytd",
          rebateEarned: 3000,
          rebateCollected: 0,
          payPeriodEnd: new Date(thisYear, 0, 31),
          collectionDate: null,
        },
      ],
    })

    const result = (await getContract("c-1")) as {
      rebateEarned: number
      rebateEarnedYTD: number
    }

    // Lifetime: both rows sum; YTD: only the current-year row.
    expect(result.rebateEarned).toBe(8000)
    expect(result.rebateEarnedYTD).toBe(3000)
    expect(result.rebateEarned).not.toBe(result.rebateEarnedYTD)
  })

  it("excludes future (unclosed) rebate periods from both fields", async () => {
    const today = new Date()
    const futureThisYear = new Date(today.getFullYear(), 11, 31)
    // Only include if current date is before Dec 31 — guard by comparing.
    const isFuture = futureThisYear > today
    contractRow = makeContract({
      rebates: [
        {
          id: "r-future",
          rebateEarned: 9999,
          rebateCollected: 0,
          payPeriodEnd: isFuture ? futureThisYear : new Date(today.getFullYear() + 1, 0, 1),
          collectionDate: null,
        },
      ],
    })

    const result = (await getContract("c-1")) as {
      rebateEarned: number
      rebateEarnedYTD: number
    }

    expect(result.rebateEarned).toBe(0)
    expect(result.rebateEarnedYTD).toBe(0)
  })

  it("YTD equals lifetime when every rebate row falls within the current year", async () => {
    const thisYear = new Date().getFullYear()
    contractRow = makeContract({
      rebates: [
        {
          id: "r1",
          rebateEarned: 1200,
          rebateCollected: 0,
          payPeriodEnd: new Date(thisYear, 0, 31),
          collectionDate: null,
        },
        {
          id: "r2",
          rebateEarned: 800,
          rebateCollected: 0,
          payPeriodEnd: new Date(thisYear, 1, 28),
          collectionDate: null,
        },
      ],
    })

    const result = (await getContract("c-1")) as {
      rebateEarned: number
      rebateEarnedYTD: number
    }

    expect(result.rebateEarnedYTD).toBe(2000)
    expect(result.rebateEarned).toBe(2000)
  })
})
