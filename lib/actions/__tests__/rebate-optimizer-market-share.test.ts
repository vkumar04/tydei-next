/**
 * Bug cluster B (2026-05-24): the OLD getRebateOpportunities must
 * surface market-share contracts with the CORRECT current tier, picked
 * against Contract.currentMarketShare — not against trailing-12mo spend.
 *
 * Fixture mirrors the Smith & Nephew screenshot:
 *   tiers: T1 ≥ 10% MS → 10%, T2 ≥ 50% MS → 15%, T3 ≥ 100% MS → 20%
 *   currentMarketShare = 92.6
 *   trailing-12mo spend = $7,325,983 (irrelevant for tier qualification)
 *
 * Expected: currentTier=2, currentRebatePercent=15, nextTier=3, nextRebatePercent=20.
 * Pre-fix behaviour: currentTier=1 (read from contract.periods[0].tierAchieved
 * or fall back to tiers[0]). Now must read from currentMarketShare via
 * pickThresholdMetric.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type Tier = {
  tierNumber: number
  tierName: string | null
  spendMin: number
  spendMax: number | null
  rebateValue: number
  rebateType: string
}
type Term = {
  id: string
  termType: string
  rebateMethod: string | null
  tiers: Tier[]
}
type Period = { totalSpend: number; tierAchieved: number | null }
type Contract = {
  id: string
  name: string
  vendorId: string
  status: string
  currentMarketShare: number | null
  complianceRate: number | null
  vendor: { name: string }
  terms: Term[]
  periods: Period[]
}

let contractRows: Contract[] = []
let cogAggRows: Array<{ vendorId: string; _sum: { extendedPrice: number } }> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findMany: vi.fn(async () => contractRows) },
    cOGRecord: { groupBy: vi.fn(async () => cogAggRows) },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1", name: "Surgical Center at Columbia" },
  })),
}))

vi.mock("@/lib/serialize", () => ({ serialize: (x: unknown) => x }))

describe("getRebateOpportunities — market_share metric routing", () => {
  beforeEach(() => {
    contractRows = []
    cogAggRows = []
  })

  it("picks Tier 2 at 92.6% market share, not Tier 1 (stale period) or Tier 3 (spend overflow)", async () => {
    contractRows = [
      {
        id: "sn-rebate",
        name: "Smith & Nephew Rebate Agreement",
        vendorId: "vendor-sn",
        status: "active",
        currentMarketShare: 92.6,
        complianceRate: null,
        vendor: { name: "Smith & Nephew" },
        periods: [{ totalSpend: 600_000, tierAchieved: 1 }],
        terms: [
          {
            id: "term-1",
            termType: "market_share",
            rebateMethod: "cumulative",
            tiers: [
              {
                tierNumber: 1, tierName: null,
                spendMin: 10, spendMax: 1_499_999,
                rebateValue: 0.10, rebateType: "percent_of_spend",
              },
              {
                tierNumber: 2, tierName: null,
                spendMin: 50, spendMax: 1_999_999,
                rebateValue: 0.15, rebateType: "percent_of_spend",
              },
              {
                tierNumber: 3, tierName: null,
                spendMin: 100, spendMax: null,
                rebateValue: 0.20, rebateType: "percent_of_spend",
              },
            ],
          },
        ],
      },
    ]
    cogAggRows = [{ vendorId: "vendor-sn", _sum: { extendedPrice: 7_325_983 } }]

    const { getRebateOpportunities } = await import("@/lib/actions/rebate-optimizer")
    const result = await getRebateOpportunities()

    expect(result).toHaveLength(1)
    const opp = result[0]
    expect(opp.contractId).toBe("sn-rebate")
    expect(opp.currentTier).toBe(2)
    expect(opp.nextTier).toBe(3)
    expect(opp.currentRebatePercent).toBe(15)
    expect(opp.nextRebatePercent).toBe(20)
  })

  it("spend_rebate path still uses currentSpend, not currentMarketShare", async () => {
    contractRows = [
      {
        id: "spend-only",
        name: "Spend-Rebate Contract",
        vendorId: "v-2",
        status: "active",
        currentMarketShare: 95,
        complianceRate: null,
        vendor: { name: "VendorTwo" },
        periods: [],
        terms: [
          {
            id: "t-2",
            termType: "spend_rebate",
            rebateMethod: "cumulative",
            tiers: [
              { tierNumber: 1, tierName: null, spendMin: 100_000, spendMax: 500_000, rebateValue: 0.02, rebateType: "percent_of_spend" },
              { tierNumber: 2, tierName: null, spendMin: 500_000, spendMax: null,    rebateValue: 0.04, rebateType: "percent_of_spend" },
            ],
          },
        ],
      },
    ]
    cogAggRows = [{ vendorId: "v-2", _sum: { extendedPrice: 250_000 } }]

    const { getRebateOpportunities } = await import("@/lib/actions/rebate-optimizer")
    const result = await getRebateOpportunities()

    expect(result).toHaveLength(1)
    expect(result[0].currentTier).toBe(1)
    expect(result[0].currentRebatePercent).toBe(2)
    expect(result[0].nextTier).toBe(2)
    expect(result[0].nextRebatePercent).toBe(4)
  })

  it("market_share contract with currentMarketShare=null reads as below baseline", async () => {
    contractRows = [
      {
        id: "no-ms",
        name: "MS unknown",
        vendorId: "v-3",
        status: "active",
        currentMarketShare: null,
        complianceRate: null,
        vendor: { name: "VendorThree" },
        periods: [],
        terms: [
          {
            id: "t-3",
            termType: "market_share",
            rebateMethod: "cumulative",
            tiers: [
              { tierNumber: 1, tierName: null, spendMin: 10, spendMax: null, rebateValue: 0.10, rebateType: "percent_of_spend" },
              { tierNumber: 2, tierName: null, spendMin: 50, spendMax: null, rebateValue: 0.15, rebateType: "percent_of_spend" },
            ],
          },
        ],
      },
    ]
    cogAggRows = [{ vendorId: "v-3", _sum: { extendedPrice: 1_000_000 } }]

    const { getRebateOpportunities } = await import("@/lib/actions/rebate-optimizer")
    const result = await getRebateOpportunities()
    expect(result).toHaveLength(1)
    expect(result[0].currentTier).toBe(0)
    expect(result[0].nextTier).toBe(1)
  })

  it("emits a zero-projection opportunity when contract is already at the top market-share tier", async () => {
    contractRows = [
      {
        id: "ms-at-top",
        name: "MS at top",
        vendorId: "v-4",
        status: "active",
        currentMarketShare: 100,
        complianceRate: null,
        vendor: { name: "VendorFour" },
        periods: [],
        terms: [
          {
            id: "t-4",
            termType: "market_share",
            rebateMethod: "cumulative",
            tiers: [
              { tierNumber: 1, tierName: null, spendMin: 10, spendMax: null, rebateValue: 0.10, rebateType: "percent_of_spend" },
              { tierNumber: 2, tierName: null, spendMin: 50, spendMax: null, rebateValue: 0.15, rebateType: "percent_of_spend" },
              { tierNumber: 3, tierName: null, spendMin: 100, spendMax: null, rebateValue: 0.20, rebateType: "percent_of_spend" },
            ],
          },
        ],
      },
    ]
    cogAggRows = [{ vendorId: "v-4", _sum: { extendedPrice: 1_000_000 } }]

    const { getRebateOpportunities } = await import("@/lib/actions/rebate-optimizer")
    const result = await getRebateOpportunities()
    // Bug 2026-05-26 (Vick): facilities want to SEE contracts even
    // when they're maxed out — the prior "drop at top tier" behavior
    // emptied the optimizer headline for a facility whose only tiered
    // contract had cleared all thresholds. We now emit a zero-
    // projection sentinel so stats.contractCount picks it up;
    // rankOpportunities still filters projectedAdditionalRebate === 0
    // out of the "Top ranked" list downstream.
    expect(result).toHaveLength(1)
    const opp = result[0]!
    expect(opp.currentTier).toBe(3)
    expect(opp.nextTier).toBe(3) // sentinel: equals currentTier when at top
    expect(opp.projectedAdditionalRebate).toBe(0)
    expect(opp.spendGap).toBe(0)
  })
})
