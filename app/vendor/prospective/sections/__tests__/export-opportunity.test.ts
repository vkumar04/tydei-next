import { describe, it, expect } from "vitest"
import {
  computeOpportunityEngine,
  DEFAULT_OPPORTUNITY_SCENARIO,
} from "@/lib/prospective-analysis/opportunity-engine"
import { computeVendorOpportunityScore } from "@/lib/prospective-analysis/vendor-opportunity-score"
import { buildOpportunityCsv } from "../export-opportunity"

describe("buildOpportunityCsv", () => {
  const engine = computeOpportunityEngine(DEFAULT_OPPORTUNITY_SCENARIO)
  const score = computeVendorOpportunityScore({
    engine,
    rebateCostPct: 0.02,
    shareOfWalletGainPct: 0.2,
    competitiveDisplacementScore: 60,
    multiBuPenetrationScore: 50,
    technologyAdoptionScore: 40,
    competitiveThreat: "Stryker",
  })
  const csv = buildOpportunityCsv(engine, score, {
    vendor: "Arthrex",
    priceChangePct: DEFAULT_OPPORTUNITY_SCENARIO.priceChangePct,
    targetShare: DEFAULT_OPPORTUNITY_SCENARIO.targetShare,
    expectedVolumeGrowthPct: DEFAULT_OPPORTUNITY_SCENARIO.expectedVolumeGrowthPct,
  })

  it("includes the scenario, score, and offer sections", () => {
    expect(csv).toContain("Opportunity Engine — Deal Scenario")
    expect(csv).toContain("Vendor Opportunity Score")
    expect(csv).toContain("Recommended Offer")
  })

  it("emits the vendor + key outputs (RFC-4180 quoted cells)", () => {
    expect(csv).toContain('"Vendor","Arthrex"')
    expect(csv).toContain('"Win probability"')
    expect(csv).toContain(`"Opportunity score","${score.overall} / 100"`)
    expect(csv).toContain(`"Incremental revenue","${engine.incrementalRevenue}"`)
  })

  it("lists every score dimension", () => {
    for (const d of [...score.financial, ...score.strategic]) {
      expect(csv).toContain(d.label)
    }
  })
})
