/**
 * Retro B3: lock down the category-scope behavior on the contracts-list
 * trailing-12mo Spend cascade read path.
 *
 * Charles W1.U-A fixed a bug family where every rebate read-path
 * ignored `ContractTerm.appliesTo` + `categories`, so a contract whose
 * terms are scoped to ["Cat A"] saw the vendor's entire spend. The
 * contracts list renders a "Current Spend (Last 12 Months)" column
 * driven by a three-tier cascade inside `getContracts`:
 *
 *   1. ContractPeriod.totalSpend (contractId-scoped, windowed)
 *   2. COGRecord.extendedPrice   (contractId-scoped, windowed)
 *   3. COGRecord.extendedPrice   (vendorId-scoped, windowed)
 *
 * Pre-W1.U tier 3 fell back to the vendor-wide aggregate, over-reporting
 * spend for category-scoped contracts. Post-W1.U a per-contract
 * category-scoped aggregate is preferred over tier 3 when every term
 * carries a non-empty `categories` list (see `getContracts` in
 * `lib/actions/contracts.ts` — the `perContractCategorySpend` block).
 *
 * Fixture mirrors the write-path test:
 *   - One contract, vendorId v-1, no ContractPeriod rollups, no
 *     contractId-scoped COG rows → cascade falls to tier 3.
 *   - Vendor-wide COG aggregate: $30K (tier-3 input).
 *   - Category-scoped aggregate for Cat A: $10K.
 *
 * Expected:
 *   - `appliesTo: "specific_category"` + `categories: ["Cat A"]` →
 *     `currentSpend` = $10K (NOT $30K).
 *   - `appliesTo: "all_products"` → `currentSpend` = $30K.
 *
 * If either assertion fails, the W1.U-A fix has regressed on the list
 * page. Don't loosen the assertion — chase the missing category filter
 * in `getContracts`. See `lib/contracts/cog-category-filter.ts`.
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
  terms: Array<{
    appliesTo: string
    categories: string[]
    tiers: Array<{ id: string }>
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
type GroupByCogVendorCategory = Array<{
  vendorId: string | null
  category: string | null
  _sum: { extendedPrice: number | null }
}>

let contractRows: ContractShape[] = []
let periodGroupBy: GroupByPeriod = []
let cogByContract: GroupByCogContract = []
let cogByVendor: GroupByCogVendor = []
// Per (vendorId, category) bucket. Charles 2026-04-26 perf pass replaced
// the per-contract `cOGRecord.aggregate` loop with ONE batched
// `groupBy(['vendorId','category'])` query; the production code sums
// the buckets that fall in each contract's category union.
let cogByVendorCategory: GroupByCogVendorCategory = []

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
        // Two-key groupBy → category-scoped batched query.
        if (by.includes("vendorId") && by.includes("category")) {
          return cogByVendorCategory
        }
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

function makeContract(
  terms: ContractShape["terms"],
  overrides: Partial<ContractShape> = {},
): ContractShape {
  return {
    id: "c-1",
    vendorId: "v-1",
    totalValue: 100000,
    rebates: [],
    terms,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  periodGroupBy = []
  cogByContract = []
  cogByVendor = []
  cogByVendorCategory = []
})

describe("getContracts — category-scoped trailing-12mo cascade (Charles W1.U-A)", () => {
  it("specific_category term: currentSpend reflects only Cat A ($10K, not $30K)", async () => {
    contractRows = [
      makeContract([
        {
          appliesTo: "specific_category",
          categories: ["Cat A"],
          tiers: [{ id: "t-1" }],
        },
      ]),
    ]
    // Tiers 1+2 empty → cascade falls to tier 3. Vendor-wide would be
    // $30K; the category-scoped helper narrows to $10K.
    periodGroupBy = []
    cogByContract = []
    cogByVendor = [{ vendorId: "v-1", _sum: { extendedPrice: 30000 } }]
    // Category bucket — sum of Cat A spend on vendor v-1 is $10K.
    cogByVendorCategory = [
      { vendorId: "v-1", category: "Cat A", _sum: { extendedPrice: 10000 } },
    ]

    const { contracts } = (await getContracts({})) as {
      contracts: Array<{ id: string; currentSpend: number }>
    }
    expect(contracts).toHaveLength(1)
    // Post-fix: $10K (Cat A only).
    // Pre-fix: $30K (vendor-wide).
    expect(contracts[0].currentSpend).toBe(10000)
    expect(contracts[0].currentSpend).not.toBe(30000)

    // Verify the category-scoped batched groupBy call routed the right
    // category filter — confirms the read path actually threads through
    // `buildUnionCategoryWhereClause`. Charles 2026-04-26 perf pass
    // replaced the per-contract aggregate with ONE batched groupBy.
    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: {
        cOGRecord: {
          groupBy: ReturnType<typeof vi.fn>
        }
      }
    }
    const calls = prisma.cOGRecord.groupBy.mock.calls as Array<
      [
        {
          by: string[]
          where: {
            category?: { in: string[] }
            vendorId?: { in: string[] }
          }
        },
      ]
    >
    const categoryCall = calls.find(
      ([arg]) => arg.by.includes("vendorId") && arg.by.includes("category"),
    )
    expect(categoryCall).toBeDefined()
    expect(categoryCall![0].where.category).toEqual({ in: ["Cat A"] })
    expect(categoryCall![0].where.vendorId).toEqual({ in: ["v-1"] })
  })

  it("all_products term: currentSpend reflects full vendor spend ($30K)", async () => {
    contractRows = [
      makeContract([
        {
          appliesTo: "all_products",
          categories: [],
          tiers: [{ id: "t-1" }],
        },
      ]),
    ]
    periodGroupBy = []
    cogByContract = []
    cogByVendor = [{ vendorId: "v-1", _sum: { extendedPrice: 30000 } }]
    // No buckets needed — the all-products path is guarded so the
    // `vendorId, category` groupBy should never fire.
    cogByVendorCategory = []

    const { contracts } = (await getContracts({})) as {
      contracts: Array<{ currentSpend: number }>
    }
    expect(contracts[0].currentSpend).toBe(30000)

    // The category-scoped groupBy path is guarded by
    // `if (categoryScopedContracts.length === 0)` — on an all-products
    // term the union helper returns {}, no contract qualifies, so the
    // batched `vendorId, category` groupBy should NOT be called.
    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: {
        cOGRecord: {
          groupBy: ReturnType<typeof vi.fn>
        }
      }
    }
    const calls = prisma.cOGRecord.groupBy.mock.calls as Array<
      [{ by: string[] }]
    >
    const categoryCall = calls.find(
      ([arg]) => arg.by.includes("vendorId") && arg.by.includes("category"),
    )
    expect(categoryCall).toBeUndefined()
  })
})
