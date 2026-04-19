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
