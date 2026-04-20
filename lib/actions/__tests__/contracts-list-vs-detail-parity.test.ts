/**
 * Parity guard — Charles W1.X-D
 *
 * The contracts list row and the contract-detail header must agree
 * on `rebateEarned` (YTD), `rebateCollected` (lifetime), and
 * `currentSpend` (trailing 12 months) for the same contract.
 *
 * Context (iMessage, 2026-04-20): Charles reported that "rebate earned
 * vs collected not matching on the list screen vs in the contract."
 * Root cause: the column accessors in `contract-columns.tsx` fell back
 * to `metricsRebate` / `metricsSpend` from `getContractMetricsBatch`,
 * which used a DB aggregate that was "kept in sync" with the canonical
 * helpers (`sumEarnedRebatesYTD`, `sumCollectedRebates`, trailing-12mo
 * spend cascade) only by comment. When they diverged, the list column
 * shadowed the canonical value; the detail page always used canonical.
 *
 * Fix: drop the batch entirely (Task 3) and the column fallbacks (Task 4).
 * This test asserts `getContracts()` and `getContract(id)` emit
 * identical values for the three invariants when fed the same rebate +
 * spend data — any regression to either reducer will fail this test
 * before a Charles-style screenshot can reach production.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type RebateRow = {
  id: string
  rebateEarned: number
  rebateCollected: number
  payPeriodEnd: Date | null
  collectionDate: Date | null
}

type ContractShape = {
  id: string
  name: string
  vendorId: string
  totalValue: number
  facilityId: string
  effectiveDate: Date
  expirationDate: Date
  status: string
  contractType: string
  createdAt: Date
  updatedAt: Date
  productCategory: null
  facility: null
  vendor: { id: string; name: string; logoUrl: string | null }
  rebates: RebateRow[]
  terms: Array<{ appliesTo: string; categories: string[]; tiers: Array<{ id: string }> }>
  periods: Array<{ id: string }>
  documents: unknown[]
  contractFacilities: unknown[]
  contractCategories: unknown[]
  createdBy: null
}

type GroupByPeriod = Array<{
  contractId: string
  _sum: { totalSpend: number | null; rebateEarned?: number | null }
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
// Single aggregates used by the detail path
let cogAgg: { _sum: { extendedPrice: number | null } } = {
  _sum: { extendedPrice: 0 },
}
let cogVendorAgg: { _sum: { extendedPrice: number | null } } = {
  _sum: { extendedPrice: 0 },
}
let periodAgg: { _sum: { totalSpend: number | null } } = {
  _sum: { totalSpend: 0 },
}

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(async () => contractRows),
      count: vi.fn(async () => contractRows.length),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = contractRows.find((c) => c.id === where.id)
        if (!found) throw new Error("not found")
        return found
      }),
    },
    contractPeriod: {
      groupBy: vi.fn(async () => periodGroupBy),
      aggregate: vi.fn(async () => periodAgg),
    },
    cOGRecord: {
      groupBy: vi.fn(async ({ by }: { by: string[] }) => {
        if (by.includes("contractId")) return cogByContract
        if (by.includes("vendorId")) return cogByVendor
        return []
      }),
      aggregate: vi.fn(async ({ where }: { where: { contractId?: string; vendorId?: string } }) => {
        if (where.contractId) return cogAgg
        if (where.vendorId) return cogVendorAgg
        return { _sum: { extendedPrice: 0 } }
      }),
    },
    rebate: {
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
  contractOwnershipWhere: vi.fn((id: string) => ({ id })),
  contractsOwnedByFacility: vi.fn(() => ({})),
  facilityScopeClause: vi.fn(() => ({})),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

import { getContracts, getContract } from "@/lib/actions/contracts"

function makeContract(overrides: Partial<ContractShape> = {}): ContractShape {
  const today = new Date()
  return {
    id: "c-1",
    name: "Parity Test Contract",
    vendorId: "v-1",
    totalValue: 1_000_000,
    facilityId: "fac-test",
    effectiveDate: new Date(today.getFullYear() - 1, 0, 1),
    expirationDate: new Date(today.getFullYear() + 1, 11, 31),
    status: "active",
    contractType: "usage",
    createdAt: today,
    updatedAt: today,
    productCategory: null,
    facility: null,
    vendor: { id: "v-1", name: "TestVendor", logoUrl: null },
    rebates: [],
    terms: [],
    periods: [],
    documents: [],
    contractFacilities: [],
    contractCategories: [],
    createdBy: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  periodGroupBy = []
  cogByContract = []
  cogByVendor = []
  cogAgg = { _sum: { extendedPrice: 0 } }
  cogVendorAgg = { _sum: { extendedPrice: 0 } }
  periodAgg = { _sum: { totalSpend: 0 } }
})

afterEach(() => {
  vi.useRealTimers()
})

describe("contracts list vs detail parity", () => {
  it("list row rebateEarned equals detail rebateEarnedYTD", async () => {
    const today = new Date()
    const thisYear = today.getFullYear()

    // Seed: one closed YTD rebate, one collected rebate, and 12mo of COG.
    const rebates: RebateRow[] = [
      {
        id: "r-1",
        rebateEarned: 58660,
        rebateCollected: 58660,
        payPeriodEnd: new Date(thisYear, today.getMonth(), 1),
        collectionDate: new Date(thisYear, today.getMonth(), 15),
      },
    ]
    contractRows = [
      makeContract({
        id: "c-parity",
        totalValue: 4_467_188,
        rebates,
      }),
    ]
    // Spend shows up in ContractPeriod.totalSpend (list cascade tier 1)
    // for list; and in contractPeriod.aggregate for detail (same tier).
    periodGroupBy = [
      { contractId: "c-parity", _sum: { totalSpend: 1_536_659 } },
    ]
    periodAgg = { _sum: { totalSpend: 1_536_659 } }

    const list = await getContracts({ facilityId: "fac-test" } as Parameters<typeof getContracts>[0])
    const row = list.contracts.find((c) => c.id === "c-parity") as
      | { rebateEarned?: number; rebateCollected?: number; currentSpend?: number }
      | undefined
    expect(row).toBeDefined()

    const detail = (await getContract("c-parity")) as {
      rebateEarnedYTD: number
      rebateCollected: number
      currentSpend: number
    }

    expect(Number(row!.rebateEarned ?? 0)).toBe(Number(detail.rebateEarnedYTD))
    expect(Number(row!.rebateCollected ?? 0)).toBe(Number(detail.rebateCollected))
    expect(Number(row!.currentSpend ?? 0)).toBe(Number(detail.currentSpend))
  })

  it("stays in parity across year boundary", async () => {
    // Dec 31 → Jan 1 flip exercises the YTD calendar-year cutoff. A row
    // whose payPeriodEnd is in the prior year must drop out of YTD on both
    // surfaces simultaneously.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-12-31T23:59:00Z"))

    const rebates: RebateRow[] = [
      {
        id: "r-2025",
        rebateEarned: 10_000,
        rebateCollected: 10_000,
        payPeriodEnd: new Date("2025-12-30T00:00:00Z"),
        collectionDate: new Date("2025-12-30T00:00:00Z"),
      },
    ]
    contractRows = [makeContract({ id: "c-ny", rebates })]

    const decList = await getContracts({ facilityId: "fac-test" } as Parameters<typeof getContracts>[0])
    const decRow = decList.contracts.find((c) => c.id === "c-ny") as
      | { rebateEarned?: number }
      | undefined
    const decDetail = (await getContract("c-ny")) as { rebateEarnedYTD: number }
    expect(Number(decRow!.rebateEarned ?? 0)).toBe(Number(decDetail.rebateEarnedYTD))

    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"))

    const janList = await getContracts({ facilityId: "fac-test" } as Parameters<typeof getContracts>[0])
    const janRow = janList.contracts.find((c) => c.id === "c-ny") as
      | { rebateEarned?: number }
      | undefined
    const janDetail = (await getContract("c-ny")) as { rebateEarnedYTD: number }
    // After the year flip both surfaces must AGREE on the count
    // (parity is the invariant under test — whether the helper
    // excludes the prior-year row is covered by the rebate-earned-filter
    // unit tests). If the two reducers disagree here, one shadowed the
    // other — that's exactly the drift this test exists to catch.
    expect(Number(janRow!.rebateEarned ?? 0)).toBe(Number(janDetail.rebateEarnedYTD))
  })

  /**
   * Deep-test mandate — reproduce Charles's iMessage report. After Task 3
   * deletes `getContractMetricsBatch` the regression-guard form is: a
   * contract with the reported dollar amounts yields identical
   * `rebateEarned` YTD on both the list row and the detail page. If this
   * ever drifts again, the fix lost its anchor.
   */
  it("matches the Charles iMessage 2026-04-20 report", async () => {
    const today = new Date()
    const thisYear = today.getFullYear()

    const rebates: RebateRow[] = [
      {
        id: "r-charles",
        rebateEarned: 58_660,
        rebateCollected: 58_660,
        payPeriodEnd: new Date(thisYear, 0, 31),
        collectionDate: new Date(thisYear, 1, 15),
      },
    ]
    contractRows = [
      makeContract({
        id: "c-charles",
        name: "Charles Report Contract",
        totalValue: 4_467_188,
        rebates,
      }),
    ]
    periodGroupBy = [
      { contractId: "c-charles", _sum: { totalSpend: 1_536_659 } },
    ]
    periodAgg = { _sum: { totalSpend: 1_536_659 } }

    const list = await getContracts({ facilityId: "fac-test" } as Parameters<typeof getContracts>[0])
    const row = list.contracts.find((c) => c.id === "c-charles") as {
      rebateEarned?: number
      rebateCollected?: number
      currentSpend?: number
    }
    const detail = (await getContract("c-charles")) as {
      rebateEarnedYTD: number
      rebateCollected: number
      currentSpend: number
    }

    // Invariant: list and detail must agree on all three fields.
    expect(Number(row.rebateEarned ?? 0)).toBe(Number(detail.rebateEarnedYTD))
    expect(Number(row.rebateCollected ?? 0)).toBe(Number(detail.rebateCollected))
    expect(Number(row.currentSpend ?? 0)).toBe(Number(detail.currentSpend))

    // Invariant: the reported values actually land where Charles saw them.
    expect(Number(detail.rebateEarnedYTD)).toBe(58_660)
    expect(Number(detail.rebateCollected)).toBe(58_660)
    expect(Number(detail.currentSpend)).toBe(1_536_659)
  })
})
