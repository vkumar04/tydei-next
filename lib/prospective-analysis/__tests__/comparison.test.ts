/**
 * Tests for compareProposals — proposal comparison (spec §subsystem-4).
 *
 * Covers: empty, single, 2-way, 3-way, every dimension best/worst,
 * overall recommendation, savings-delta sign, and deterministic id-asc
 * tie-breaking.
 */

import { describe, it, expect } from "vitest"
import {
  compareProposals,
  type ProposalForComparison,
} from "../comparison"

type Scores = ProposalForComparison["scores"]

function makeProposal(
  id: string,
  scores: Scores,
  opts: Partial<Omit<ProposalForComparison, "id" | "scores">> = {},
): ProposalForComparison {
  return {
    id,
    vendorName: opts.vendorName ?? `Vendor ${id}`,
    scores,
    proposedAnnualSpend: opts.proposedAnnualSpend ?? 500_000,
    proposedRebateRate: opts.proposedRebateRate ?? 5,
    termYears: opts.termYears ?? 3,
    totalProjectedSavings: opts.totalProjectedSavings ?? 0,
  }
}

function scores(
  costSavings = 5,
  priceCompetitiveness = 5,
  rebateAttainability = 5,
  lockInRisk = 5,
  tco = 5,
  overall = 5,
): Scores {
  return {
    costSavings,
    priceCompetitiveness,
    rebateAttainability,
    lockInRisk,
    tco,
    overall,
  }
}

describe("compareProposals", () => {
  it("empty input returns empty bests/worsts + null recommended + null delta", () => {
    const result = compareProposals([])
    expect(result.proposals).toEqual([])
    expect(result.bestOnDimension).toEqual({})
    expect(result.worstOnDimension).toEqual({})
    expect(result.recommendedProposalId).toBeNull()
    expect(result.savingsDeltaVsRunnerUp).toBeNull()
  })

  it("single proposal — best == worst on every dimension, delta null", () => {
    const p = makeProposal("a", scores(1, 2, 3, 4, 5, 3), {
      totalProjectedSavings: 100_000,
    })
    const result = compareProposals([p])
    expect(result.proposals).toEqual([p])
    expect(result.recommendedProposalId).toBe("a")
    expect(result.savingsDeltaVsRunnerUp).toBeNull()
    for (const k of [
      "costSavings",
      "priceCompetitiveness",
      "rebateAttainability",
      "lockInRisk",
      "tco",
      "overall",
    ] as const) {
      expect(result.bestOnDimension[k]).toBe("a")
      expect(result.worstOnDimension[k]).toBe("a")
    }
  })

  it("2-way comparison picks winner on each dimension", () => {
    const a = makeProposal("a", scores(8, 4, 6, 9, 5, 6.5), {
      totalProjectedSavings: 200_000,
    })
    const b = makeProposal("b", scores(3, 9, 7, 2, 8, 5.8), {
      totalProjectedSavings: 150_000,
    })
    const result = compareProposals([a, b])
    expect(result.bestOnDimension.costSavings).toBe("a")
    expect(result.worstOnDimension.costSavings).toBe("b")
    expect(result.bestOnDimension.priceCompetitiveness).toBe("b")
    expect(result.worstOnDimension.priceCompetitiveness).toBe("a")
    expect(result.bestOnDimension.rebateAttainability).toBe("b")
    expect(result.bestOnDimension.lockInRisk).toBe("a")
    expect(result.bestOnDimension.tco).toBe("b")
    expect(result.bestOnDimension.overall).toBe("a")
    expect(result.recommendedProposalId).toBe("a")
    expect(result.savingsDeltaVsRunnerUp).toBe(50_000)
  })

  it("3-way comparison ranks by overall; savings delta is vs runner-up", () => {
    const a = makeProposal("a", scores(5, 5, 5, 5, 5, 6.0), {
      totalProjectedSavings: 100_000,
    })
    const b = makeProposal("b", scores(5, 5, 5, 5, 5, 8.0), {
      totalProjectedSavings: 300_000,
    })
    const c = makeProposal("c", scores(5, 5, 5, 5, 5, 7.0), {
      totalProjectedSavings: 250_000,
    })
    const result = compareProposals([a, b, c])
    expect(result.recommendedProposalId).toBe("b")
    // runner-up is c (overall 7.0); delta = 300k - 250k = 50k
    expect(result.savingsDeltaVsRunnerUp).toBe(50_000)
  })

  it("best/worst computed on every dimension independently", () => {
    const a = makeProposal("a", scores(10, 0, 5, 5, 5, 5))
    const b = makeProposal("b", scores(0, 10, 5, 5, 5, 5))
    const c = makeProposal("c", scores(5, 5, 10, 0, 5, 5))
    const d = makeProposal("d", scores(5, 5, 0, 10, 5, 5))
    const e = makeProposal("e", scores(5, 5, 5, 5, 10, 9))
    const f = makeProposal("f", scores(5, 5, 5, 5, 0, 1))
    const result = compareProposals([a, b, c, d, e, f])
    expect(result.bestOnDimension.costSavings).toBe("a")
    expect(result.worstOnDimension.costSavings).toBe("b")
    expect(result.bestOnDimension.priceCompetitiveness).toBe("b")
    expect(result.worstOnDimension.priceCompetitiveness).toBe("a")
    expect(result.bestOnDimension.rebateAttainability).toBe("c")
    expect(result.worstOnDimension.rebateAttainability).toBe("d")
    expect(result.bestOnDimension.lockInRisk).toBe("d")
    expect(result.worstOnDimension.lockInRisk).toBe("c")
    expect(result.bestOnDimension.tco).toBe("e")
    expect(result.worstOnDimension.tco).toBe("f")
    expect(result.bestOnDimension.overall).toBe("e")
    expect(result.worstOnDimension.overall).toBe("f")
  })

  it("recommended is winner by overall score (savings delta is signed)", () => {
    // Recommended has LOWER totalProjectedSavings than runner-up → negative delta
    // (savings here is not the recommendation driver; overall score is).
    const a = makeProposal("a", scores(5, 5, 5, 5, 5, 9.0), {
      totalProjectedSavings: 10_000,
    })
    const b = makeProposal("b", scores(5, 5, 5, 5, 5, 5.0), {
      totalProjectedSavings: 500_000,
    })
    const result = compareProposals([a, b])
    expect(result.recommendedProposalId).toBe("a")
    expect(result.savingsDeltaVsRunnerUp).toBe(10_000 - 500_000)
  })

  it("positive savings delta when recommended also has higher totalProjectedSavings", () => {
    const a = makeProposal("a", scores(5, 5, 5, 5, 5, 7.0), {
      totalProjectedSavings: 400_000,
    })
    const b = makeProposal("b", scores(5, 5, 5, 5, 5, 6.0), {
      totalProjectedSavings: 100_000,
    })
    const result = compareProposals([a, b])
    expect(result.recommendedProposalId).toBe("a")
    expect(result.savingsDeltaVsRunnerUp).toBe(300_000)
    expect(result.savingsDeltaVsRunnerUp).toBeGreaterThan(0)
  })

  it("ties break by lexicographically-lower id (best + worst + overall)", () => {
    // Feed in non-alphabetical order to prove the tiebreaker isn't input order.
    const z = makeProposal("z", scores(5, 5, 5, 5, 5, 5), {
      totalProjectedSavings: 100_000,
    })
    const a = makeProposal("a", scores(5, 5, 5, 5, 5, 5), {
      totalProjectedSavings: 200_000,
    })
    const m = makeProposal("m", scores(5, 5, 5, 5, 5, 5), {
      totalProjectedSavings: 50_000,
    })
    const result = compareProposals([z, a, m])
    expect(result.bestOnDimension.costSavings).toBe("a")
    expect(result.worstOnDimension.costSavings).toBe("a")
    expect(result.bestOnDimension.overall).toBe("a")
    expect(result.recommendedProposalId).toBe("a")
    // Runner-up by id-asc tiebreak is "m" (savings 50k); delta = 200k - 50k.
    expect(result.savingsDeltaVsRunnerUp).toBe(150_000)
  })

  it("preserves input order in proposals echo", () => {
    const c = makeProposal("c", scores())
    const a = makeProposal("a", scores())
    const b = makeProposal("b", scores())
    const result = compareProposals([c, a, b])
    expect(result.proposals.map((p) => p.id)).toEqual(["c", "a", "b"])
  })
})
