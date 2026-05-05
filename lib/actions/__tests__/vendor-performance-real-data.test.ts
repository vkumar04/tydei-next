/**
 * Regression tests for the vendor /performance page rewrite (Charles
 * V2 audit). Pre-fix the page mixed real values (`activeFacilities`,
 * `compliance`) with hardcoded `MOCK_*` constants — radar 92/88/96/94/89,
 * MOCK_CATEGORY_BREAKDOWN, MOCK_DEFAULT_REBATE_TIERS, MOCK_MONTHLY_TREND.
 * These tests pin:
 *   1. `getVendorPerformance` returns null (not stubs) for axes without
 *      a real data source (delivery / quality / pricing / responsiveness).
 *   2. `getVendorPerformanceCategoryBreakdown` is sourced from cOGRecord
 *      vendorId-filtered groupBy, NOT a constant.
 *   3. `getVendorPerformanceMonthlyTrend` matches the canonical
 *      cOGRecord pattern from getVendorSpendTrend.
 *   4. `getVendorPerformanceTiers` scales `ContractTier.rebateValue`
 *      (stored as fraction) by 100 per CLAUDE.md "Rebate engine units"
 *      rule.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type CogRow = {
  transactionDate: Date
  extendedPrice: number
  vendorId?: string | null
  contractId?: string | null
}

let cogFindMany: CogRow[] = []
let cogAgg: { _sum: { extendedPrice: number | null } } = {
  _sum: { extendedPrice: 0 },
}
let cogGroupByCategory: Array<{
  category: string | null
  _sum: { extendedPrice: number | null }
}> = []
let cogGroupByCategoryPrior: Array<{
  category: string | null
  _sum: { extendedPrice: number | null }
}> = []
let cogGroupByContract: Array<{
  contractId: string | null
  _sum: { extendedPrice: number | null }
}> = []
let groupByCallIndex = 0

let contractFindMany: Array<Record<string, unknown>> = []
let contractCount = 0
let contractGroupBy: Array<{ facilityId: string | null }> = []
let rebateFindMany: Array<{
  payPeriodEnd: Date | null
  rebateEarned: number
  contractId?: string
}> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      findMany: vi.fn(async () => cogFindMany),
      aggregate: vi.fn(async () => cogAgg),
      groupBy: vi.fn(async (args: { by: string[] }) => {
        if (args.by.includes("contractId")) return cogGroupByContract
        // category groupBy is called twice in
        // getVendorPerformanceCategoryBreakdown (current then prior).
        const result =
          groupByCallIndex === 0 ? cogGroupByCategory : cogGroupByCategoryPrior
        groupByCallIndex += 1
        return result
      }),
    },
    contract: {
      count: vi.fn(async () => contractCount),
      findMany: vi.fn(async () => contractFindMany),
      groupBy: vi.fn(async () => contractGroupBy),
    },
    rebate: {
      findMany: vi.fn(async () => rebateFindMany),
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
  cogGroupByCategory = []
  cogGroupByCategoryPrior = []
  cogGroupByContract = []
  groupByCallIndex = 0
  contractFindMany = []
  contractCount = 0
  contractGroupBy = []
  rebateFindMany = []
})

describe("getVendorPerformance — radar axes default to null, not stubs", () => {
  it("returns null for delivery / quality / pricing / responsiveness regardless of contract count", async () => {
    contractCount = 5
    contractGroupBy = [{ facilityId: "f-1" }, { facilityId: "f-2" }]
    contractFindMany = [{ totalValue: 1000, annualValue: 1000 }]
    cogAgg = { _sum: { extendedPrice: 500 } }
    rebateFindMany = []

    const { getVendorPerformance } = await import(
      "@/lib/actions/vendor-analytics"
    )
    const result = await getVendorPerformance("v-stryker")
    // Pre-fix: delivery/quality/pricing returned 95 / 90 / 85 whenever
    // contractCount > 0. This is the regression guard.
    expect(result.delivery).toBeNull()
    expect(result.quality).toBeNull()
    expect(result.pricing).toBeNull()
    expect(result.responsiveness).toBeNull()
    // Compliance is real: 500 spend / 1000 target = 50%.
    expect(result.compliance).toBe(50)
    expect(result.activeFacilities).toBe(2)
    expect(result.contractCount).toBe(5)
  })

  it("returns null compliance when there is no annual target to measure against", async () => {
    contractCount = 0
    contractGroupBy = []
    contractFindMany = []
    cogAgg = { _sum: { extendedPrice: 0 } }

    const { getVendorPerformance } = await import(
      "@/lib/actions/vendor-analytics"
    )
    const result = await getVendorPerformance("v-stryker")
    expect(result.compliance).toBeNull()
    expect(result.delivery).toBeNull()
  })
})

describe("getVendorPerformanceCategoryBreakdown — sourced from cOGRecord", () => {
  it("groups vendor-scoped COG by category for trailing 12 mo with prior period as baseline", async () => {
    cogGroupByCategory = [
      { category: "Implants", _sum: { extendedPrice: 1000 } },
      { category: "Disposables", _sum: { extendedPrice: 500 } },
    ]
    cogGroupByCategoryPrior = [
      { category: "Implants", _sum: { extendedPrice: 800 } },
      { category: "Equipment", _sum: { extendedPrice: 200 } },
    ]
    const { getVendorPerformanceCategoryBreakdown } = await import(
      "@/lib/actions/vendor-analytics"
    )
    const rows = await getVendorPerformanceCategoryBreakdown("v-stryker")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      category: "Implants",
      spend: 1000,
      priorSpend: 800,
      pctOfPrior: 125,
    })
    // Disposables: no prior comparator → pctOfPrior null
    expect(rows[1].pctOfPrior).toBeNull()
    // Filter is vendorId-scoped (canonical per CLAUDE.md).
    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: { cOGRecord: { groupBy: ReturnType<typeof vi.fn> } }
    }
    const call = prisma.cOGRecord.groupBy.mock.calls[0][0] as {
      where: { vendorId?: string }
    }
    expect(call.where.vendorId).toBe("v-stryker")
  })
})

describe("getVendorPerformanceTiers — rebateValue scaled by 100 at the boundary", () => {
  it("converts ContractTier.rebateValue (fraction) to a percentage rate", async () => {
    // Stored as fraction per CLAUDE.md "Rebate engine units" — 0.05
    // means 5%, NOT 5%.
    contractFindMany = [
      {
        id: "c-1",
        name: "Stryker Joint",
        facility: { name: "Lighthouse" },
        terms: [
          {
            tiers: [
              {
                tierNumber: 1,
                tierName: "Tier 1",
                spendMin: 100_000,
                rebateValue: 0.03,
                rebateType: "percent_of_spend",
              },
              {
                tierNumber: 2,
                tierName: "Tier 2",
                spendMin: 250_000,
                rebateValue: 0.05,
                rebateType: "percent_of_spend",
              },
            ],
          },
        ],
      },
    ]
    cogGroupByContract = [
      { contractId: "c-1", _sum: { extendedPrice: 150_000 } },
    ]

    const { getVendorPerformanceTiers } = await import(
      "@/lib/actions/vendor-analytics"
    )
    const tiers = await getVendorPerformanceTiers("v-stryker")
    expect(tiers).toHaveLength(2)
    expect(tiers[0]).toMatchObject({
      tier: "Tier 1",
      threshold: 100_000,
      current: 150_000,
      rebateRate: 3,
      achieved: true,
    })
    expect(tiers[1]).toMatchObject({
      tier: "Tier 2",
      threshold: 250_000,
      current: 150_000,
      rebateRate: 5,
      achieved: false,
    })
  })
})

describe("getVendorPerformanceMonthlyTrend — cOGRecord-backed, NOT a constant", () => {
  it("buckets vendor-scoped COG by transactionDate year-month", async () => {
    cogFindMany = [
      { transactionDate: new Date("2026-01-15"), extendedPrice: 100 },
      { transactionDate: new Date("2026-01-31"), extendedPrice: 50 },
      { transactionDate: new Date("2026-02-10"), extendedPrice: 200 },
    ]
    rebateFindMany = [
      {
        payPeriodEnd: new Date("2026-02-28"),
        rebateEarned: 7,
      },
    ]
    const { getVendorPerformanceMonthlyTrend } = await import(
      "@/lib/actions/vendor-analytics"
    )
    const result = await getVendorPerformanceMonthlyTrend("v-stryker")
    expect(result).toEqual([
      { month: "2026-01", spend: 150, rebates: 0 },
      { month: "2026-02", spend: 200, rebates: 7 },
    ])
  })
})
