import { describe, it, expect } from "vitest"
import {
  buildProposalNarrative,
  type ProposalNarrativeInput,
} from "@/components/facility/analysis/prospective/proposal-narrative"

// The prospective proposal report must tell the story, not just list tables
// (Vick 2026-06-22 "same pdf changes on the prospective side").
const full: ProposalNarrativeInput = {
  vendorName: "Stryker",
  verdict: {
    verdict: "negotiate",
    confidence: "medium",
    reasons: [],
    missingInputs: ["a price file"],
  } as unknown as ProposalNarrativeInput["verdict"],
  scored: {
    result: { scores: { overall: 7.4 } },
  } as unknown as ProposalNarrativeInput["scored"],
  lookback: {
    vendorId: "v1",
    trailing12moSpend: 1_200_000,
    predicted: { tierAchieved: 3, rebatePercent: 4.5, annualRebate: 54_000 },
  } as unknown as ProposalNarrativeInput["lookback"],
  pricing: {
    summary: {
      totalCurrentAnnualSpend: 1_000_000,
      potentialSavings: 80_000,
      avgVariancePercent: -8,
      itemsWithCOGMatch: 42,
      totalItems: 50,
    },
  } as unknown as ProposalNarrativeInput["pricing"],
  legal: {
    overallRiskScore: 35,
    overallRiskLevel: "moderate",
    criticalFlags: [{}, {}],
  } as unknown as ProposalNarrativeInput["legal"],
}

describe("buildProposalNarrative", () => {
  const text = buildProposalNarrative(full)

  it("opens with the vendor, verdict, and term score", () => {
    expect(text).toMatch(/Stryker/)
    expect(text).toMatch(/worth negotiating/)
    expect(text).toMatch(/7\.4\/10/)
  })

  it("states savings vs current cost and the rebate projection", () => {
    expect(text).toMatch(/annual savings/i)
    expect(text).toMatch(/Tier 3/)
    expect(text).toMatch(/in rebates/i)
  })

  it("reports legal risk with the critical-flag count", () => {
    expect(text).toMatch(/overall risk 35\/100 \(moderate\)/)
    expect(text).toMatch(/2 critical flags/)
  })

  it("nudges on missing inputs", () => {
    expect(text).toMatch(/would firm up with a price file/)
  })

  it("flags a net-new relationship when there are no existing contracts", () => {
    const netNew = buildProposalNarrative({
      ...full,
      lookback: {
        vendorId: null,
        trailing12moSpend: 0,
        predicted: null,
      } as unknown as ProposalNarrativeInput["lookback"],
    })
    expect(netNew).toMatch(/net-new vendor relationship/i)
  })

  it("degrades to a bare header when nothing is analyzed yet", () => {
    expect(
      buildProposalNarrative({
        vendorName: null,
        verdict: null,
        scored: null,
        lookback: null,
        pricing: null,
        legal: null,
      }),
    ).toBe("Proposal analysis for this vendor.")
  })
})
