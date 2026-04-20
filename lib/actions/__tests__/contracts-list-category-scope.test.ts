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

let contractRows: ContractShape[] = []
let periodGroupBy: GroupByPeriod = []
let cogByContract: GroupByCogContract = []
let cogByVendor: GroupByCogVendor = []
// Per-contract category-scoped aggregate. The production code runs
// `prisma.cOGRecord.aggregate` once per category-scoped contract with a
// `{ category: { in: [...] } }` where-fragment; the mock returns this
// value only when the caller passes a non-empty category filter
// (otherwise we fall through to $0 so the test doesn't accidentally
// double-count with the vendor-wide aggregate).
let categoryAggregate = 0

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
      aggregate: vi.fn(
        async (arg: {
          where: { category?: { in: string[] } }
        }) => {
          // Only return the category-scoped number when the caller
          // actually supplied the category filter. This mirrors the
          // production guard in `getContracts` (runs aggregate ONLY
          // when `unionCategoryWhere.category` is truthy).
          if (!arg?.where?.category?.in?.length) {
            return { _sum: { extendedPrice: 0 } }
          }
          return { _sum: { extendedPrice: categoryAggregate } }
        },
      ),
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
  categoryAggregate = 0
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
    categoryAggregate = 10000

    const { contracts } = (await getContracts({})) as {
      contracts: Array<{ id: string; currentSpend: number }>
    }
    expect(contracts).toHaveLength(1)
    // Post-fix: $10K (Cat A only).
    // Pre-fix: $30K (vendor-wide).
    expect(contracts[0].currentSpend).toBe(10000)
    expect(contracts[0].currentSpend).not.toBe(30000)

    // Verify the aggregate call used the category filter — confirms the
    // read path actually routes through `buildUnionCategoryWhereClause`.
    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: {
        cOGRecord: {
          aggregate: ReturnType<typeof vi.fn>
        }
      }
    }
    expect(prisma.cOGRecord.aggregate).toHaveBeenCalled()
    const aggArg = prisma.cOGRecord.aggregate.mock.calls[0][0] as {
      where: { category?: { in: string[] }; vendorId?: string }
    }
    expect(aggArg.where.category).toEqual({ in: ["Cat A"] })
    expect(aggArg.where.vendorId).toBe("v-1")
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
    // categoryAggregate stays 0 — even if the production code called
    // aggregate with no category filter, our mock returns 0 for that
    // case. The expected behavior is that aggregate is NOT called for
    // all-products contracts (the union helper returns {}).
    categoryAggregate = 0

    const { contracts } = (await getContracts({})) as {
      contracts: Array<{ currentSpend: number }>
    }
    expect(contracts[0].currentSpend).toBe(30000)

    // The per-contract category aggregate path is guarded by
    // `if (!unionWhere.category) return` — on an all-products term the
    // union helper returns {}, so aggregate should NOT be called.
    const { prisma } = (await import("@/lib/db")) as unknown as {
      prisma: {
        cOGRecord: {
          aggregate: ReturnType<typeof vi.fn>
        }
      }
    }
    expect(prisma.cOGRecord.aggregate).not.toHaveBeenCalled()
  })
})
