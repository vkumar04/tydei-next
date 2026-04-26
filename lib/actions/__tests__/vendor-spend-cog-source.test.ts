/**
 * Regression tests for vendor-side spend reducers (Charles 2026-04-26
 * Bug 2 + Bug 3 + Bug 5). On prod, Stryker @ Lighthouse Surgical Center
 * has $1.7M+ of categorized COG but ZERO ContractPeriod rows — so
 * every surface that read spend from ContractPeriod silently rendered
 * $0. Per CLAUDE.md, ContractPeriod must NEVER be the sole spend
 * source for vendor surfaces. These tests pin the cOGRecord-based
 * cascade for:
 *   - getVendorSpendTrend (sources spend from cOGRecord rows)
 *   - getVendorContractDetail.lifetimeTotals.spend
 *     (falls back to cOGRecord.extendedPrice when periods are empty)
 *   - getVendorMarketShareByCategory
 *     (returns rich {rows, uncategorizedSpend, totalVendorSpend} shape)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type CogRow = {
  transactionDate: Date
  extendedPrice: number
  category?: string | null
  vendorId?: string | null
}

let cogFindMany: CogRow[] = []
let cogAgg: { _sum: { extendedPrice: number | null } } = {
  _sum: { extendedPrice: 0 },
}
let cogGroupBy: Array<{
  category: string | null
  _sum: { extendedPrice: number | null }
}> = []
let periodAgg: { _sum: { totalSpend: number | null } } = {
  _sum: { totalSpend: 0 },
}
let rebateFindMany: Array<{
  rebateEarned: number
  rebateCollected: number
  payPeriodEnd: Date | null
  collectionDate: Date | null
}> = []
let contractRow: Record<string, unknown> | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      findMany: vi.fn(async () => cogFindMany),
      aggregate: vi.fn(async () => cogAgg),
      groupBy: vi.fn(async () => cogGroupBy),
    },
    contractPeriod: {
      aggregate: vi.fn(async () => periodAgg),
    },
    rebate: {
      findMany: vi.fn(async () => rebateFindMany),
    },
    contract: {
      findUniqueOrThrow: vi.fn(async () => {
        if (!contractRow) throw new Error("not found")
        return contractRow
      }),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: vi.fn(async () => ({
    vendor: { id: "v-stryker" },
    user: { id: "u-1" },
  })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

beforeEach(() => {
  vi.clearAllMocks()
  cogFindMany = []
  cogAgg = { _sum: { extendedPrice: 0 } }
  cogGroupBy = []
  periodAgg = { _sum: { totalSpend: 0 } }
  rebateFindMany = []
  contractRow = null
})

describe("getVendorSpendTrend — spend bucketed from cOGRecord (Bug 2)", () => {
  it("buckets cOGRecord by transactionDate year-month, NOT ContractPeriod", async () => {
    // Repro: Stryker @ Lighthouse has zero ContractPeriod rows but
    // millions in COG. Old code returned [] → "No spend data".
    cogFindMany = [
      { transactionDate: new Date("2026-01-15"), extendedPrice: 100 },
      { transactionDate: new Date("2026-01-31"), extendedPrice: 50 },
      { transactionDate: new Date("2026-02-10"), extendedPrice: 200 },
    ]
    const { getVendorSpendTrend } = await import(
      "@/lib/actions/vendor-dashboard"
    )
    const result = (await getVendorSpendTrend({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    })) as Array<{ month: string; spend: number; rebate: number }>

    expect(result).toEqual([
      { month: "2026-01", spend: 150, rebate: 0 },
      { month: "2026-02", spend: 200, rebate: 0 },
    ])

    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: { cOGRecord: { findMany: ReturnType<typeof vi.fn> } }
    }
    // Confirm we filtered by vendorId (the canonical vendor-spend filter).
    const call = prisma.cOGRecord.findMany.mock.calls[0][0] as {
      where: { vendorId?: string }
    }
    expect(call.where.vendorId).toBe("v-stryker")
  })

  it("layers Rebate rows by payPeriodEnd onto the same monthly bucket", async () => {
    cogFindMany = [
      { transactionDate: new Date("2026-03-05"), extendedPrice: 1000 },
    ]
    rebateFindMany = [
      {
        rebateEarned: 25,
        rebateCollected: 0,
        payPeriodEnd: new Date("2026-03-31"),
        collectionDate: null,
      },
    ]
    const { getVendorSpendTrend } = await import(
      "@/lib/actions/vendor-dashboard"
    )
    const result = (await getVendorSpendTrend({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    })) as Array<{ month: string; spend: number; rebate: number }>
    expect(result).toEqual([{ month: "2026-03", spend: 1000, rebate: 25 }])
  })
})

describe("getVendorContractDetail — spendToDate cOG fallback (Bug 3)", () => {
  it("falls back to cOGRecord.extendedPrice when ContractPeriod is empty", async () => {
    contractRow = {
      id: "c-stryker-1",
      vendorId: "v-stryker",
      totalValue: 0,
      vendor: { id: "v-stryker", name: "Stryker", logoUrl: null },
      facility: { id: "f-1", name: "Lighthouse Surgical Center" },
      productCategory: null,
      terms: [],
      documents: [],
      periods: [],
      changeProposals: [],
    }
    periodAgg = { _sum: { totalSpend: 0 } }
    cogAgg = { _sum: { extendedPrice: 1_700_000 } }

    const { getVendorContractDetail } = await import(
      "@/lib/actions/vendor-contracts"
    )
    const result = (await getVendorContractDetail("c-stryker-1")) as {
      lifetimeTotals: { spend: number }
    }
    expect(result.lifetimeTotals.spend).toBe(1_700_000)
  })

  it("prefers ContractPeriod when populated (persisted rollup wins)", async () => {
    contractRow = {
      id: "c-1",
      vendorId: "v-stryker",
      totalValue: 0,
      vendor: { id: "v-stryker", name: "Stryker", logoUrl: null },
      facility: { id: "f-1", name: "Lighthouse" },
      productCategory: null,
      terms: [],
      documents: [],
      periods: [],
      changeProposals: [],
    }
    periodAgg = { _sum: { totalSpend: 1_033_798 } }
    cogAgg = { _sum: { extendedPrice: 690_620 } }
    const { getVendorContractDetail } = await import(
      "@/lib/actions/vendor-contracts"
    )
    const result = (await getVendorContractDetail("c-1")) as {
      lifetimeTotals: { spend: number }
    }
    expect(result.lifetimeTotals.spend).toBe(1_033_798)
  })

  it("scopes the cOG aggregate to {contractId, vendorId} (no leak)", async () => {
    contractRow = {
      id: "c-1",
      vendorId: "v-stryker",
      totalValue: 0,
      vendor: { id: "v-stryker", name: "Stryker", logoUrl: null },
      facility: { id: "f-1", name: "Lighthouse" },
      productCategory: null,
      terms: [],
      documents: [],
      periods: [],
      changeProposals: [],
    }
    const { getVendorContractDetail } = await import(
      "@/lib/actions/vendor-contracts"
    )
    await getVendorContractDetail("c-1")
    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: { cOGRecord: { aggregate: ReturnType<typeof vi.fn> } }
    }
    const call = prisma.cOGRecord.aggregate.mock.calls[0][0] as {
      where: { contractId?: string; vendorId?: string }
    }
    expect(call.where.contractId).toBe("c-1")
    expect(call.where.vendorId).toBe("v-stryker")
  })
})

describe("getVendorMarketShareByCategory — rich empty-state shape (Bug 5)", () => {
  it("returns {rows, uncategorizedSpend, totalVendorSpend} when ALL spend is uncategorized", async () => {
    cogFindMany = [
      { transactionDate: new Date(), extendedPrice: 500_000, category: null },
      { transactionDate: new Date(), extendedPrice: 12_964, category: null },
    ]
    const { getVendorMarketShareByCategory } = await import(
      "@/lib/actions/vendor-dashboard"
    )
    const result = (await getVendorMarketShareByCategory()) as {
      rows: Array<{ category: string; share: number }>
      uncategorizedSpend: number
      totalVendorSpend: number
    }
    expect(result.rows).toEqual([])
    expect(result.uncategorizedSpend).toBe(512_964)
    expect(result.totalVendorSpend).toBe(512_964)
  })

  it("returns categorized rows + uncategorized spend in mixed case", async () => {
    cogFindMany = [
      {
        transactionDate: new Date(),
        extendedPrice: 100,
        category: "Joint Replacement",
      },
      {
        transactionDate: new Date(),
        extendedPrice: 50,
        category: null,
      },
    ]
    cogGroupBy = [
      {
        category: "Joint Replacement",
        _sum: { extendedPrice: 200 },
      },
    ]
    const { getVendorMarketShareByCategory } = await import(
      "@/lib/actions/vendor-dashboard"
    )
    const result = (await getVendorMarketShareByCategory()) as {
      rows: Array<{ category: string; share: number }>
      uncategorizedSpend: number
      totalVendorSpend: number
    }
    expect(result.totalVendorSpend).toBe(150)
    expect(result.uncategorizedSpend).toBe(50)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].share).toBeCloseTo(50)
  })

  it("returns zeros when vendor has no COG at all", async () => {
    const { getVendorMarketShareByCategory } = await import(
      "@/lib/actions/vendor-dashboard"
    )
    const result = (await getVendorMarketShareByCategory()) as {
      rows: Array<unknown>
      uncategorizedSpend: number
      totalVendorSpend: number
    }
    expect(result).toEqual({
      rows: [],
      uncategorizedSpend: 0,
      totalVendorSpend: 0,
    })
  })
})
