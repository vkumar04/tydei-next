import { describe, it, expect } from "vitest"
import { rankOpportunities } from "@/lib/rebate-optimizer/rank-opportunities"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

function opp(overrides: Partial<RebateOpportunity>): RebateOpportunity {
  return {
    contractId: "c-1",
    contractName: "Contract 1",
    vendorName: "Vendor 1",
    currentTier: 0,
    nextTier: 1,
    currentSpend: 0,
    nextTierThreshold: 100_000,
    spendGap: 100_000,
    projectedAdditionalRebate: 0,
    percentToNextTier: 0,
    currentRebatePercent: 0,
    nextRebatePercent: 0,
    topTierRebatePercent: 0,
    topTierThreshold: 100_000,
    ...overrides,
  }
}

describe("rankOpportunities", () => {
  it("drops opportunities with projectedAdditionalRebate === 0", () => {
    // The bug case: Smith & Nephew / Arthrex showed "Increase spend by $0
    // to reach Tier 1 and earn an additional $0 in rebates" because the
    // contract's tier-progress evaluated to a zero rebate delta. Those
    // entries are not actionable opportunities.
    const result = rankOpportunities([
      opp({ contractId: "zero-1", projectedAdditionalRebate: 0 }),
      opp({ contractId: "real", projectedAdditionalRebate: 5_000 }),
      opp({ contractId: "zero-2", projectedAdditionalRebate: 0 }),
    ])
    expect(result.map((o) => o.contractId)).toEqual(["real"])
  })

  it("drops opportunities with negative projectedAdditionalRebate", () => {
    // Defensive: tier-rate regressions could in theory produce a negative
    // delta. Never list those as opportunities.
    const result = rankOpportunities([
      opp({ contractId: "neg", projectedAdditionalRebate: -100 }),
      opp({ contractId: "pos", projectedAdditionalRebate: 200 }),
    ])
    expect(result.map((o) => o.contractId)).toEqual(["pos"])
  })

  it("sorts remaining opportunities by projectedAdditionalRebate descending", () => {
    const result = rankOpportunities([
      opp({ contractId: "small", projectedAdditionalRebate: 100 }),
      opp({ contractId: "big", projectedAdditionalRebate: 10_000 }),
      opp({ contractId: "medium", projectedAdditionalRebate: 1_000 }),
    ])
    expect(result.map((o) => o.contractId)).toEqual(["big", "medium", "small"])
  })

  it("returns an empty array when all opportunities are zero-rebate", () => {
    // Equivalent to the user's "No ranked opportunities available yet."
    // empty-state copy in opportunities-recommendations.tsx.
    const result = rankOpportunities([
      opp({ contractId: "z1", projectedAdditionalRebate: 0 }),
      opp({ contractId: "z2", projectedAdditionalRebate: 0 }),
    ])
    expect(result).toEqual([])
  })

  it("preserves the rest of the opportunity object on the surviving entries", () => {
    // The hook chain (sortedOpportunities → OpportunitiesRecommendations
    // → calculator dialog) reads many fields. Filter + sort must not
    // mutate or shape-shift the entries.
    const input = opp({
      contractId: "keep",
      contractName: "Tie-In Contract",
      vendorName: "Stryker",
      currentSpend: 250_000,
      projectedAdditionalRebate: 7_500,
      percentToNextTier: 62,
    })
    const [out] = rankOpportunities([input])
    expect(out).toEqual(input)
  })

  it("does not mutate the input array", () => {
    const input = [
      opp({ contractId: "small", projectedAdditionalRebate: 100 }),
      opp({ contractId: "big", projectedAdditionalRebate: 10_000 }),
      opp({ contractId: "zero", projectedAdditionalRebate: 0 }),
    ]
    const snapshot = input.map((o) => o.contractId)
    rankOpportunities(input)
    expect(input.map((o) => o.contractId)).toEqual(snapshot)
  })
})
