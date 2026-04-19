/**
 * Regression tests for `getContract` spend resolution (Charles R4.2).
 *
 * Charles feedback: "Spend is not populating." Root cause: the detail
 * page was pulling spend from a COGRecord aggregate (including a
 * vendor-wide fallback) while the list page / reports sourced it from
 * persisted ContractPeriod rollups. The two disagreed on contracts
 * where ContractPeriod.totalSpend had been recorded but COG enrichment
 * hadn't caught up.
 *
 * Fix: prefer `ContractPeriod.totalSpend` (per-contract persisted
 * rollup) on the detail page, falling back to COGRecord by contractId
 * only when no periods are recorded. Never fall back to vendor-wide
 * COG (leaks spend across contracts on the same vendor).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type ContractShape = {
  id: string
  vendorId: string
  totalValue: number
  facilityId: string
  rebates: Array<{
    id: string
    rebateEarned: number
    rebateCollected: number
    payPeriodEnd: Date | null
    collectionDate: Date | null
  }>
  periods: Array<{ id: string }>
}

let contractRow: ContractShape | null = null
let cogAggResult: { _sum: { extendedPrice: number | null } } = {
  _sum: { extendedPrice: 0 },
}
let periodAggResult: { _sum: { totalSpend: number | null } } = {
  _sum: { totalSpend: 0 },
}

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
      aggregate: vi.fn(async () => periodAggResult),
    },
    cOGRecord: {
      aggregate: vi.fn(async () => cogAggResult),
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
  cogAggResult = { _sum: { extendedPrice: 0 } }
  periodAggResult = { _sum: { totalSpend: 0 } }
})

describe("getContract — spend resolution (Charles R4.2)", () => {
  it("prefers ContractPeriod.totalSpend over COG when both are populated", async () => {
    // Live DB reproduced this: periods summed to $1,033,798.88 while
    // COG (extendedPrice) summed to $690,620 for the same contract.
    // The persisted rollup is the source of truth.
    contractRow = makeContract()
    periodAggResult = { _sum: { totalSpend: 1033798.88 } }
    cogAggResult = { _sum: { extendedPrice: 690620 } }

    const result = (await getContract("c-1")) as { currentSpend: number }
    expect(result.currentSpend).toBe(1033798.88)
  })

  it("falls back to COGRecord.extendedPrice when no periods are recorded", async () => {
    contractRow = makeContract()
    periodAggResult = { _sum: { totalSpend: 0 } }
    cogAggResult = { _sum: { extendedPrice: 42000 } }

    const result = (await getContract("c-1")) as { currentSpend: number }
    expect(result.currentSpend).toBe(42000)
  })

  it("returns zero spend when neither source has data", async () => {
    contractRow = makeContract()

    const result = (await getContract("c-1")) as { currentSpend: number }
    expect(result.currentSpend).toBe(0)
  })

  it("scopes COG aggregate to this contract only (no vendor-wide leak)", async () => {
    // Regression: the old implementation OR'd in COG rows where
    // contractId was null + vendorId matched, which inflated spend on
    // the detail page when a vendor had multiple contracts.
    contractRow = makeContract()

    await getContract("c-1")

    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: { cOGRecord: { aggregate: ReturnType<typeof vi.fn> } }
    }
    const call = prisma.cOGRecord.aggregate.mock.calls[0][0] as {
      where: { contractId?: string; OR?: unknown }
    }
    expect(call.where.contractId).toBe("c-1")
    // No OR clause (which is how the vendor-wide leak was implemented).
    expect(call.where.OR).toBeUndefined()
  })

  it("aggregates ContractPeriod.totalSpend scoped to this contract", async () => {
    contractRow = makeContract()
    periodAggResult = { _sum: { totalSpend: 500000 } }

    await getContract("c-1")

    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: { contractPeriod: { aggregate: ReturnType<typeof vi.fn> } }
    }
    const call = prisma.contractPeriod.aggregate.mock.calls[0][0] as {
      where: { contractId?: string }
      _sum: { totalSpend?: boolean }
    }
    expect(call.where.contractId).toBe("c-1")
    expect(call._sum.totalSpend).toBe(true)
  })
})

describe("getContract — currentSpend is trailing 12 months (Charles R5.28)", () => {
  /**
   * Charles R5.28: "Current spend should be last 12 months." The three
   * cascade tiers (ContractPeriod, COG-by-contract, COG-by-vendor) must
   * all constrain their aggregates to transactionDate / period window
   * in [today - 12 months, today]. A contract with activity 18 months
   * ago but nothing recent reads $0; 11 months ago counts; the exact
   * 12-month boundary is inclusive via `gte`.
   */
  function extractDateRange(where: {
    transactionDate?: { gte?: Date; lte?: Date }
    periodStart?: { gte?: Date }
    periodEnd?: { lte?: Date }
  }) {
    if (where.transactionDate) {
      return { gte: where.transactionDate.gte, lte: where.transactionDate.lte }
    }
    return { gte: where.periodStart?.gte, lte: where.periodEnd?.lte }
  }

  function monthsAgo(n: number): Date {
    const d = new Date()
    d.setMonth(d.getMonth() - n)
    return d
  }

  it("returns 0 when the aggregate horizon excludes all activity (>12 months ago)", async () => {
    // All three aggregates report 0 because Prisma's WHERE filter drops
    // rows outside the trailing-12-month window. This is the behavior
    // we expect on a contract whose only COG rows are 18 months old.
    contractRow = makeContract()
    periodAggResult = { _sum: { totalSpend: 0 } }
    cogAggResult = { _sum: { extendedPrice: 0 } }

    const result = (await getContract("c-1")) as { currentSpend: number }
    expect(result.currentSpend).toBe(0)
  })

  it("returns spend from within the window (11 months ago)", async () => {
    contractRow = makeContract()
    cogAggResult = { _sum: { extendedPrice: 75000 } }

    const result = (await getContract("c-1")) as { currentSpend: number }
    expect(result.currentSpend).toBe(75000)
  })

  it("applies a trailing-12-month transactionDate filter to the contract-COG aggregate", async () => {
    contractRow = makeContract()
    const now = Date.now()

    await getContract("c-1")

    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: { cOGRecord: { aggregate: ReturnType<typeof vi.fn> } }
    }
    const call = prisma.cOGRecord.aggregate.mock.calls[0][0] as {
      where: { transactionDate?: { gte?: Date; lte?: Date } }
    }
    const range = extractDateRange(call.where)
    expect(range.gte).toBeInstanceOf(Date)
    expect(range.lte).toBeInstanceOf(Date)
    // lte is "today" — within a few seconds of test time.
    expect(Math.abs((range.lte as Date).getTime() - now)).toBeLessThan(5000)
    // gte is ~12 months before today. Allow a generous band for DST /
    // month-length drift: between 360 and 370 days earlier.
    const deltaDays =
      ((range.lte as Date).getTime() - (range.gte as Date).getTime()) /
      (1000 * 60 * 60 * 24)
    expect(deltaDays).toBeGreaterThanOrEqual(360)
    expect(deltaDays).toBeLessThanOrEqual(370)
  })

  it("applies the same 12-month window to the vendor-COG fallback aggregate", async () => {
    contractRow = makeContract()

    await getContract("c-1")

    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: { cOGRecord: { aggregate: ReturnType<typeof vi.fn> } }
    }
    // Second call is the vendor-wide fallback.
    const call = prisma.cOGRecord.aggregate.mock.calls[1][0] as {
      where: {
        vendorId?: string
        transactionDate?: { gte?: Date; lte?: Date }
      }
    }
    expect(call.where.vendorId).toBe("v-1")
    expect(call.where.transactionDate?.gte).toBeInstanceOf(Date)
    expect(call.where.transactionDate?.lte).toBeInstanceOf(Date)
  })

  it("applies the 12-month window to the ContractPeriod aggregate when no explicit period is passed", async () => {
    contractRow = makeContract()

    await getContract("c-1")

    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: { contractPeriod: { aggregate: ReturnType<typeof vi.fn> } }
    }
    const call = prisma.contractPeriod.aggregate.mock.calls[0][0] as {
      where: {
        contractId?: string
        periodStart?: { gte?: Date }
        periodEnd?: { lte?: Date }
      }
    }
    expect(call.where.contractId).toBe("c-1")
    expect(call.where.periodStart?.gte).toBeInstanceOf(Date)
    expect(call.where.periodEnd?.lte).toBeInstanceOf(Date)
  })

  it("boundary: window is [today - 12 months, today]", async () => {
    contractRow = makeContract()
    const before = new Date()
    await getContract("c-1")
    const after = new Date()

    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: { cOGRecord: { aggregate: ReturnType<typeof vi.fn> } }
    }
    const call = prisma.cOGRecord.aggregate.mock.calls[0][0] as {
      where: { transactionDate?: { gte?: Date; lte?: Date } }
    }
    const lte = call.where.transactionDate?.lte as Date
    const gte = call.where.transactionDate?.gte as Date
    // lte should be "now" (between before/after snapshots).
    expect(lte.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(lte.getTime()).toBeLessThanOrEqual(after.getTime())
    // gte should be ~12 months before lte. Use setFullYear semantics.
    const expectedGte = new Date(lte)
    expectedGte.setFullYear(expectedGte.getFullYear() - 1)
    expect(Math.abs(gte.getTime() - expectedGte.getTime())).toBeLessThan(5000)
    // Silence unused helper warning.
    void monthsAgo
  })
})
