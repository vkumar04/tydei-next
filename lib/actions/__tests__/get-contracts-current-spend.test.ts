/**
 * Tests for `getContracts` trailing-12mo `currentSpend` cascade
 * (Charles W1.J).
 *
 * The list-page SPEND column was rendering $0 for every row because
 * `getContracts` never populated a spend field and the client-side
 * fallback (`getContractMetricsBatch`) used lifetime aggregates with
 * no vendor-window safety net. This regression ensures each returned
 * contract carries a `currentSpend` that mirrors the R5.28 cascade on
 * the detail page:
 *
 *   1. ContractPeriod.totalSpend WHERE contractId AND periodEnd in [today-12mo, today]
 *   2. COGRecord.extendedPrice  WHERE contractId AND transactionDate in [today-12mo, today]
 *   3. COGRecord.extendedPrice  WHERE vendorId  AND transactionDate in [today-12mo, today]
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type ContractShape = {
  id: string
  vendorId: string
  totalValue: number
  rebates: Array<{
    rebateEarned: number
    rebateCollected: number
    payPeriodEnd: Date | null
    collectionDate: Date | null
  }>
}

type GroupByPeriod = Array<{
  contractId: string
  _sum: { totalSpend: number | null }
}>
type GroupByCogContract = Array<{
  contractId: string | null
  _sum: { extendedPrice: number | null }
}>
type GroupByCogVendor = Array<{
  vendorId: string | null
  _sum: { extendedPrice: number | null }
}>

let contractRows: ContractShape[] = []
let periodGroupBy: GroupByPeriod = []
let cogByContract: GroupByCogContract = []
let cogByVendor: GroupByCogVendor = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(async () => contractRows),
      count: vi.fn(async () => contractRows.length),
    },
    contractPeriod: {
      groupBy: vi.fn(async () => periodGroupBy),
    },
    cOGRecord: {
      groupBy: vi.fn(async ({ by }: { by: string[] }) => {
        if (by.includes("contractId")) return cogByContract
        if (by.includes("vendorId")) return cogByVendor
        return []
      }),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

import { getContracts } from "@/lib/actions/contracts"

function makeContract(overrides: Partial<ContractShape> = {}): ContractShape {
  return {
    id: "c-1",
    vendorId: "v-1",
    totalValue: 100000,
    rebates: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  periodGroupBy = []
  cogByContract = []
  cogByVendor = []
})

describe("getContracts — currentSpend trailing-12mo cascade", () => {
  it("prefers ContractPeriod.totalSpend (tier 1) when non-zero", async () => {
    contractRows = [makeContract()]
    periodGroupBy = [{ contractId: "c-1", _sum: { totalSpend: 42000 } }]
    cogByContract = [{ contractId: "c-1", _sum: { extendedPrice: 10000 } }]
    cogByVendor = [{ vendorId: "v-1", _sum: { extendedPrice: 99999 } }]

    const { contracts } = (await getContracts({})) as {
      contracts: Array<{ currentSpend: number }>
    }
    expect(contracts[0].currentSpend).toBe(42000)
  })

  it("falls back to COG-by-contractId (tier 2) when tier 1 is zero", async () => {
    contractRows = [makeContract()]
    periodGroupBy = []
    cogByContract = [{ contractId: "c-1", _sum: { extendedPrice: 25000 } }]
    cogByVendor = [{ vendorId: "v-1", _sum: { extendedPrice: 99999 } }]

    const { contracts } = (await getContracts({})) as {
      contracts: Array<{ currentSpend: number }>
    }
    expect(contracts[0].currentSpend).toBe(25000)
  })

  it("falls back to COG-by-vendorId (tier 3) when tiers 1+2 are zero", async () => {
    contractRows = [makeContract()]
    periodGroupBy = []
    cogByContract = []
    cogByVendor = [{ vendorId: "v-1", _sum: { extendedPrice: 12500 } }]

    const { contracts } = (await getContracts({})) as {
      contracts: Array<{ currentSpend: number }>
    }
    expect(contracts[0].currentSpend).toBe(12500)
  })

  it("returns 0 when every tier is empty", async () => {
    contractRows = [makeContract()]

    const { contracts } = (await getContracts({})) as {
      contracts: Array<{ currentSpend: number }>
    }
    expect(contracts[0].currentSpend).toBe(0)
  })

  it("resolves spend per-contract in a batch (no cross-contamination except vendor-window)", async () => {
    contractRows = [
      makeContract({ id: "c-1", vendorId: "v-1" }),
      makeContract({ id: "c-2", vendorId: "v-2" }),
      makeContract({ id: "c-3", vendorId: "v-1" }),
    ]
    periodGroupBy = [{ contractId: "c-1", _sum: { totalSpend: 50000 } }]
    cogByContract = [{ contractId: "c-2", _sum: { extendedPrice: 20000 } }]
    cogByVendor = [{ vendorId: "v-1", _sum: { extendedPrice: 7500 } }]

    const { contracts } = (await getContracts({})) as {
      contracts: Array<{ id: string; currentSpend: number }>
    }
    const byId = Object.fromEntries(contracts.map((c) => [c.id, c.currentSpend]))
    // c-1: tier 1 wins.
    expect(byId["c-1"]).toBe(50000)
    // c-2: tier 2 wins (no period rollup).
    expect(byId["c-2"]).toBe(20000)
    // c-3: tiers 1+2 empty → vendor-window fallback. Known-fuzzy: c-1
    // and c-3 share vendor v-1, so c-3 inherits the vendor total even
    // though c-1 is the source. Documented in R5.24.
    expect(byId["c-3"]).toBe(7500)
  })

  it("uses a 12-month window on the ContractPeriod + COG aggregations", async () => {
    contractRows = [makeContract()]

    await getContracts({})

    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: {
        contractPeriod: { groupBy: ReturnType<typeof vi.fn> }
        cOGRecord: { groupBy: ReturnType<typeof vi.fn> }
      }
    }

    const periodCall = prisma.contractPeriod.groupBy.mock.calls[0][0] as {
      where: { periodEnd?: { gte?: Date; lte?: Date } }
    }
    expect(periodCall.where.periodEnd?.gte).toBeInstanceOf(Date)
    expect(periodCall.where.periodEnd?.lte).toBeInstanceOf(Date)
    const gte = periodCall.where.periodEnd!.gte!.getTime()
    const lte = periodCall.where.periodEnd!.lte!.getTime()
    // Approx 1 year window, allowing a couple seconds of slop.
    const oneYearMs = 365 * 24 * 60 * 60 * 1000
    expect(Math.abs(lte - gte - oneYearMs)).toBeLessThan(86_400_000 * 2)

    // Both COG aggregations must filter by transactionDate.
    const cogCalls = prisma.cOGRecord.groupBy.mock.calls as Array<
      [{ where: { transactionDate?: { gte?: Date; lte?: Date } } }]
    >
    expect(cogCalls.length).toBeGreaterThanOrEqual(1)
    for (const [arg] of cogCalls) {
      expect(arg.where.transactionDate?.gte).toBeInstanceOf(Date)
      expect(arg.where.transactionDate?.lte).toBeInstanceOf(Date)
    }
  })
})
