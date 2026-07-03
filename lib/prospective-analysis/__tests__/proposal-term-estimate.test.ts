import { describe, expect, it } from "vitest"

import {
  defaultTargetTypeForTermType,
  estimateProposalTerms,
  type ProposalTermEstimateInput,
} from "../proposal-term-estimate"

const SPEND = 1_000_000
const VOLUME = 500

const term = (
  overrides: Partial<ProposalTermEstimateInput> & { termType: string },
): ProposalTermEstimateInput => ({
  name: "",
  targetValue: 0,
  rebatePercent: 0,
  ...overrides,
})

describe("defaultTargetTypeForTermType", () => {
  it("routes each termType to its metric", () => {
    expect(defaultTargetTypeForTermType("spend_rebate")).toBe("spend")
    expect(defaultTargetTypeForTermType("volume_rebate")).toBe("volume")
    expect(defaultTargetTypeForTermType("market_share_rebate")).toBe(
      "market_share",
    )
    expect(defaultTargetTypeForTermType("price_reduction")).toBe("spend")
    expect(defaultTargetTypeForTermType("anything_else")).toBe("spend")
  })
})

describe("spend_rebate", () => {
  it("flat percent pays percent × projected spend when the target is met", () => {
    const r = estimateProposalTerms(
      [term({ termType: "spend_rebate", targetValue: 500_000, rebatePercent: 3 })],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(30_000)
    expect(r.totalSavings).toBe(0)
  })

  it("flat percent pays $0 below the target, with a below-target note", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "spend_rebate",
          targetValue: 2_000_000,
          rebatePercent: 3,
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(0)
    expect(r.perTerm[0]!.note).toMatch(/below/i)
  })

  it("walks the tier ladder on projectedSpend — highest achieved min wins", () => {
    const tiers = [
      { min: 250_000, value: 1 },
      { min: 500_000, value: 2 },
      { min: 2_000_000, value: 4 },
    ]
    const r = estimateProposalTerms(
      [term({ termType: "spend_rebate", rebatePercent: 99, tiers })],
      SPEND,
      VOLUME,
    )
    // $1M reaches tier 2 (min $500K), not tier 3 — 2% × $1M, and the flat
    // rebatePercent (99) is ignored when tiers exist.
    expect(r.totalRebate).toBe(20_000)
    expect(r.perTerm[0]!.note).toMatch(/Tier 2 of 3/)
  })

  it("tier ladder pays $0 below the first tier", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "spend_rebate",
          tiers: [{ min: 5_000_000, value: 3 }],
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(0)
    expect(r.perTerm[0]!.note).toMatch(/below the first tier/i)
  })

  it("unsorted tiers are sorted before the walk", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "spend_rebate",
          tiers: [
            { min: 500_000, value: 2 },
            { min: 250_000, value: 1 },
          ],
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(20_000)
  })

  it("fixed rebateType pays the flat dollar amount, never ×spend", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "spend_rebate",
          targetValue: 500_000,
          rebatePercent: 30_000,
          rebateType: "fixed",
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(30_000)
  })
})

describe("volume_rebate", () => {
  it("thresholds are UNITS, not dollars — met when projectedVolume ≥ target", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "volume_rebate",
          targetType: "volume",
          targetValue: 400,
          rebatePercent: 10,
          rebateType: "per_unit",
        }),
      ],
      SPEND,
      VOLUME,
    )
    // $10/unit × 500 units — NOT spend × % (the old inline bug).
    expect(r.totalRebate).toBe(5_000)
  })

  it("pays $0 when projected volume is below the unit target", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "volume_rebate",
          targetType: "volume",
          targetValue: 10_000,
          rebatePercent: 10,
          rebateType: "per_unit",
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(0)
    expect(r.perTerm[0]!.note).toMatch(/below/i)
  })

  it("percent rebateType on a volume term pays percent × spend", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "volume_rebate",
          targetType: "volume",
          targetValue: 100,
          rebatePercent: 2,
          rebateType: "percent",
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(20_000)
  })

  it("tier ladder walks on UNITS for volume targets", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "volume_rebate",
          targetType: "volume",
          rebateType: "per_unit",
          tiers: [
            { min: 100, value: 5 },
            { min: 450, value: 8 },
            { min: 1_000, value: 12 },
          ],
        }),
      ],
      SPEND,
      VOLUME,
    )
    // 500 units reaches the 450-unit tier: $8/unit × 500.
    expect(r.totalRebate).toBe(4_000)
    expect(r.perTerm[0]!.note).toMatch(/Tier 2 of 3/)
  })

  it("missing targetType defaults to volume for volume_rebate", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "volume_rebate",
          targetValue: 400, // units — met by 500 projected volume, NOT $ spend
          rebatePercent: 10,
          rebateType: "per_unit",
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(5_000)
  })
})

describe("market_share_rebate", () => {
  it("pays percent × spend, assuming the commitment is met (labeled)", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "market_share_rebate",
          targetType: "market_share",
          targetValue: 70, // PERCENT — never dollars
          rebatePercent: 2.5,
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(25_000)
    expect(r.perTerm[0]!.note).toMatch(/assumes/i)
    expect(r.perTerm[0]!.note).toMatch(/commitment is met/i)
  })

  it("tier ladder mins are share PERCENTS, walked at the committed share", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "market_share_rebate",
          targetType: "market_share",
          targetValue: 65,
          tiers: [
            { min: 40, value: 1 },
            { min: 60, value: 2 },
            { min: 80, value: 3 },
          ],
        }),
      ],
      SPEND,
      VOLUME,
    )
    // 65% commitment reaches the 60% tier: 2% × $1M.
    expect(r.totalRebate).toBe(20_000)
    expect(r.perTerm[0]!.note).toMatch(/assumes/i)
  })
})

describe("price_reduction", () => {
  it("contributes SAVINGS (price delta × volume), never rebate", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "price_reduction",
          targetValue: 500_000, // spend threshold ($) — met
          rebatePercent: 25, // $25 off per unit
          rebateType: "per_unit",
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(0)
    expect(r.totalSavings).toBe(12_500) // $25 × 500 units
    expect(r.perTerm[0]!.savings).toBe(12_500)
    expect(r.perTerm[0]!.rebate).toBe(0)
    expect(r.perTerm[0]!.note).toMatch(/savings/i)
    expect(r.perTerm[0]!.note).toMatch(/not a rebate/i)
  })

  it("percent price reduction saves discount % × spend", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "price_reduction",
          targetValue: 0,
          rebatePercent: 5,
          rebateType: "percent",
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalSavings).toBe(50_000)
    expect(r.totalRebate).toBe(0)
  })

  it("gated on the spend threshold — $0 savings below it", () => {
    const r = estimateProposalTerms(
      [
        term({
          termType: "price_reduction",
          targetValue: 5_000_000,
          rebatePercent: 5,
        }),
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalSavings).toBe(0)
    expect(r.perTerm[0]!.note).toMatch(/below/i)
  })
})

describe("totals + mixed proposals", () => {
  it("sums rebate and savings independently across terms", () => {
    const r = estimateProposalTerms(
      [
        term({ termType: "spend_rebate", targetValue: 0, rebatePercent: 3 }), // $30K rebate
        term({
          termType: "price_reduction",
          targetValue: 0,
          rebatePercent: 2,
        }), // $20K savings
        term({
          termType: "market_share_rebate",
          targetType: "market_share",
          targetValue: 50,
          rebatePercent: 1,
        }), // $10K rebate (assumed met)
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(40_000)
    expect(r.totalSavings).toBe(20_000)
    expect(r.perTerm).toHaveLength(3)
  })

  it("historic terms (no rebateType, no tiers) behave as flat percent", () => {
    // Exactly what a pre-2026-07 saved proposal round-trips as.
    const r = estimateProposalTerms(
      [
        {
          termType: "spend_rebate",
          name: "Annual Spend Rebate",
          targetType: "spend",
          targetValue: 500_000,
          rebatePercent: 3,
        },
      ],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(30_000)
  })

  it("empty terms → zero totals", () => {
    const r = estimateProposalTerms([], SPEND, VOLUME)
    expect(r.totalRebate).toBe(0)
    expect(r.totalSavings).toBe(0)
    expect(r.perTerm).toEqual([])
  })

  it("unknown termType falls back to a spend ladder, not a crash", () => {
    const r = estimateProposalTerms(
      [term({ termType: "growth_rebate", targetValue: 0, rebatePercent: 2 })],
      SPEND,
      VOLUME,
    )
    expect(r.totalRebate).toBe(20_000)
  })
})
