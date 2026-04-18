/**
 * Tests for getRebateOpportunities (engine-wired) — the Prisma-backed
 * server action that delegates to buildRebateOpportunities +
 * generateRebateAlerts.
 *
 * Exercises:
 *   - facility scoping (ownership via contractsOwnedByFacility)
 *   - status filter (active + expiring only)
 *   - vendor-spend aggregation from COG rows
 *   - Prisma → engine shape translation (termType, boundaryRule, method)
 *   - drop categorization (empty contracts → NO_REBATE_TERMS etc.)
 *   - alert ranking routed through generateRebateAlerts
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Tier = {
  tierNumber: number
  tierName: string | null
  spendMin: number
  spendMax: number | null
  rebateValue: number
}

type Term = {
  id: string
  termType: string
  rebateMethod: string | null
  boundaryRule: string | null
  tiers: Tier[]
}

type Contract = {
  id: string
  name: string
  vendorId: string
  facilityId: string | null
  status: string
  expirationDate: Date
  vendor: { id: string; name: string }
  terms: Term[]
}

type CogAggRow = { vendorId: string; _sum: { extendedPrice: number } }

let contractRows: Contract[] = []
let cogAggRows: CogAggRow[] = []
let lastContractWhere: Record<string, unknown> | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(
        async ({ where }: { where?: Record<string, unknown> } = {}) => {
          lastContractWhere = where ?? null
          const status = (where?.status as { in: string[] } | undefined)?.in ?? [
            "active",
            "expiring",
          ]
          return contractRows.filter((c) => status.includes(c.status))
        },
      ),
    },
    cOGRecord: {
      groupBy: vi.fn(
        async ({
          where,
        }: {
          where: { vendorId?: { in?: string[] }; facilityId?: string }
        }) => {
          const ids = where.vendorId?.in ?? []
          return cogAggRows.filter((r) => ids.includes(r.vendorId))
        },
      ),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({
    user: { id: "user-1" },
    facility: { id: "fac-1" },
  }),
}))

import { getRebateOpportunities } from "@/lib/actions/rebate-optimizer-engine"

function makeTier(
  tierNumber: number,
  spendMin: number,
  rebateValue: number,
): Tier {
  return {
    tierNumber,
    tierName: `Tier ${tierNumber}`,
    spendMin,
    spendMax: null,
    rebateValue,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  cogAggRows = []
  lastContractWhere = null
})

describe("getRebateOpportunities (engine-wired)", () => {
  it("scopes via contractsOwnedByFacility and active+expiring status", async () => {
    await getRebateOpportunities()

    expect(lastContractWhere).not.toBeNull()
    const w = lastContractWhere as {
      status: { in: string[] }
      OR: unknown
    }
    expect(w.status.in).toEqual(["active", "expiring"])
    expect(w.OR).toBeTruthy()
  })

  it("returns an opportunity when spend qualifies a next-tier jump", async () => {
    contractRows = [
      {
        id: "c-1",
        name: "Medline Supply",
        vendorId: "v-1",
        facilityId: "fac-1",
        status: "active",
        expirationDate: new Date("2027-01-01"),
        vendor: { id: "v-1", name: "Medline" },
        terms: [
          {
            id: "t-1",
            termType: "spend_rebate",
            rebateMethod: "cumulative",
            boundaryRule: "exclusive",
            tiers: [
              makeTier(1, 0, 2),
              makeTier(2, 100_000, 3),
              makeTier(3, 250_000, 5),
            ],
          },
        ],
      },
    ]
    cogAggRows = [{ vendorId: "v-1", _sum: { extendedPrice: 150_000 } }]

    const result = await getRebateOpportunities()

    expect(result.opportunities).toHaveLength(1)
    const opp = result.opportunities[0]!
    expect(opp.contractId).toBe("c-1")
    expect(opp.currentSpend).toBe(150_000)
    expect(opp.nextTierNumber).toBe(3)
    expect(opp.additionalRebate).toBeGreaterThan(0)
    expect(result.droppedContracts).toEqual([])
  })

  it("drops contracts with no rebate terms as NO_REBATE_TERMS", async () => {
    contractRows = [
      {
        id: "c-2",
        name: "Empty Terms Co",
        vendorId: "v-2",
        facilityId: "fac-1",
        status: "active",
        expirationDate: new Date("2027-01-01"),
        vendor: { id: "v-2", name: "EmptyVendor" },
        terms: [],
      },
    ]
    cogAggRows = [{ vendorId: "v-2", _sum: { extendedPrice: 50_000 } }]

    const result = await getRebateOpportunities()

    expect(result.opportunities).toEqual([])
    expect(result.droppedContracts).toHaveLength(1)
    expect(result.droppedContracts[0]!.reason).toBe("NO_REBATE_TERMS")
  })

  it("maps carve_out / po_rebate term types and drops ONLY_CARVE_OUT_OR_PO_REBATE", async () => {
    contractRows = [
      {
        id: "c-3",
        name: "Carve Only",
        vendorId: "v-3",
        facilityId: "fac-1",
        status: "active",
        expirationDate: new Date("2027-01-01"),
        vendor: { id: "v-3", name: "Carver" },
        terms: [
          {
            id: "t-3",
            termType: "carve_out",
            rebateMethod: null,
            boundaryRule: null,
            tiers: [],
          },
        ],
      },
    ]
    cogAggRows = [{ vendorId: "v-3", _sum: { extendedPrice: 200_000 } }]

    const result = await getRebateOpportunities()

    expect(result.opportunities).toEqual([])
    expect(result.droppedContracts).toHaveLength(1)
    expect(result.droppedContracts[0]!.reason).toBe(
      "ONLY_CARVE_OUT_OR_PO_REBATE",
    )
  })

  it("drops contracts with zero vendor spend as ZERO_SPEND", async () => {
    contractRows = [
      {
        id: "c-4",
        name: "No Spend",
        vendorId: "v-4",
        facilityId: "fac-1",
        status: "active",
        expirationDate: new Date("2027-01-01"),
        vendor: { id: "v-4", name: "Ghost" },
        terms: [
          {
            id: "t-4",
            termType: "spend_rebate",
            rebateMethod: "cumulative",
            boundaryRule: "exclusive",
            tiers: [makeTier(1, 0, 2), makeTier(2, 100_000, 3)],
          },
        ],
      },
    ]
    cogAggRows = [] // no spend row for v-4

    const result = await getRebateOpportunities()

    expect(result.opportunities).toEqual([])
    expect(result.droppedContracts[0]?.reason).toBe("ZERO_SPEND")
  })

  it("emits ranked alerts through generateRebateAlerts for each opportunity", async () => {
    // Close to threshold (pctToGo <= 5, monthsToReach <= 3) → at_tier_threshold HIGH
    contractRows = [
      {
        id: "c-hot",
        name: "Almost There",
        vendorId: "v-hot",
        facilityId: "fac-1",
        status: "active",
        expirationDate: new Date(
          new Date().getTime() + 365 * 24 * 60 * 60 * 1000,
        ),
        vendor: { id: "v-hot", name: "Hot Vendor" },
        terms: [
          {
            id: "t-hot",
            termType: "spend_rebate",
            rebateMethod: "cumulative",
            boundaryRule: "exclusive",
            tiers: [makeTier(1, 0, 2), makeTier(2, 100_000, 3)],
          },
        ],
      },
    ]
    // 98,000 spend → 2% to 100,000 → at_tier_threshold
    cogAggRows = [{ vendorId: "v-hot", _sum: { extendedPrice: 98_000 } }]

    const result = await getRebateOpportunities()

    expect(result.opportunities).toHaveLength(1)
    expect(result.rankedAlerts.length).toBeGreaterThan(0)
    const firstAlert = result.rankedAlerts[0]!
    expect(firstAlert.contractId).toBe("c-hot")
    expect(["at_tier_threshold", "approaching_next_tier"]).toContain(
      firstAlert.kind,
    )
  })

  it("serializes all Decimals — opportunities survive JSON round-trip", async () => {
    contractRows = [
      {
        id: "c-json",
        name: "Serialize Me",
        vendorId: "v-json",
        facilityId: "fac-1",
        status: "expiring",
        expirationDate: new Date("2027-01-01"),
        vendor: { id: "v-json", name: "JsonVendor" },
        terms: [
          {
            id: "t-json",
            termType: "spend_rebate",
            rebateMethod: "marginal",
            boundaryRule: "inclusive",
            tiers: [makeTier(1, 0, 1), makeTier(2, 50_000, 2)],
          },
        ],
      },
    ]
    cogAggRows = [{ vendorId: "v-json", _sum: { extendedPrice: 30_000 } }]

    const result = await getRebateOpportunities()
    const json = JSON.stringify(result)
    const parsed = JSON.parse(json) as typeof result
    expect(parsed.opportunities[0]?.contractId).toBe("c-json")
  })
})
