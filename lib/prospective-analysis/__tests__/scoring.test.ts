/**
 * Tests for calculateProposalScores — scoring engine (spec §subsystem-0).
 *
 * Covers each clamp boundary, the additive lock-in penalty, TCO cap,
 * edge cases (currentSpend=0, minimumSpend=0), and the exact weighted
 * overall sum against hand-computed worked examples.
 */

import { describe, it, expect } from "vitest"
import {
  calculateProposalScores,
  SCORE_WEIGHTS,
  type ProposalInput,
} from "../scoring"

function baseInput(partial: Partial<ProposalInput> = {}): ProposalInput {
  return {
    proposedAnnualSpend: 500_000,
    currentSpend: 500_000,
    priceVsMarket: 0,
    minimumSpend: 500_000,
    proposedRebateRate: 5,
    termYears: 1,
    exclusivity: false,
    marketShareCommitment: null,
    minimumSpendIsHighPct: false,
    priceProtection: false,
    paymentTermsNet60Or90: false,
    volumeDiscountAbove5Percent: false,
    ...partial,
  }
}

describe("calculateProposalScores — worked examples", () => {
  it("perfect-score proposal scores overall ≥ 9", () => {
    // $100K saved on $500K current → savingsPercent = 20 → costSavings = 10.
    // priceVsMarket = +10 → priceCompetitiveness = 5 + 10/4 = 7.5.
    // currentSpend / minimumSpend = 500/100 = 5 → rebate = 25, clamped → 10.
    // 1-year term, no exclusivity, no MSC, low min → lockIn = 10.
    // TCO extras all on → 6 + 2 + 1 + 1 = 10.
    const s = calculateProposalScores(
      baseInput({
        proposedAnnualSpend: 400_000,
        currentSpend: 500_000,
        priceVsMarket: 10,
        minimumSpend: 100_000,
        termYears: 1,
        exclusivity: false,
        marketShareCommitment: null,
        minimumSpendIsHighPct: false,
        priceProtection: true,
        paymentTermsNet60Or90: true,
        volumeDiscountAbove5Percent: true,
      }),
    )
    expect(s.costSavings).toBe(10)
    expect(s.priceCompetitiveness).toBe(7.5)
    expect(s.rebateAttainability).toBe(10)
    expect(s.lockInRisk).toBe(10)
    expect(s.tco).toBe(10)
    // 0.3×10 + 0.2×7.5 + 0.2×10 + 0.15×10 + 0.15×10 = 9.5
    expect(s.overall).toBeCloseTo(9.5, 5)
    expect(s.overall).toBeGreaterThanOrEqual(9)
  })

  it("decline proposal scores overall ≤ 3", () => {
    // 0 savings, priceVsMarket = +10 (score 7.5), $1M min on $100K spend
    // (rebate = (100/1000)×5 = 0.5), 5yr exclusive 90% MSC 85% min
    // → penalty = 2+3+2+2 = 9 → lockIn = 1; TCO baseline 6.
    const s = calculateProposalScores(
      baseInput({
        proposedAnnualSpend: 100_000,
        currentSpend: 100_000,
        priceVsMarket: 10,
        minimumSpend: 1_000_000,
        termYears: 5,
        exclusivity: true,
        marketShareCommitment: 90,
        minimumSpendIsHighPct: true,
        priceProtection: false,
        paymentTermsNet60Or90: false,
        volumeDiscountAbove5Percent: false,
      }),
    )
    expect(s.costSavings).toBe(0)
    expect(s.priceCompetitiveness).toBe(7.5)
    expect(s.rebateAttainability).toBe(0.5)
    expect(s.lockInRisk).toBe(1)
    expect(s.tco).toBe(6)
    // 0.3×0 + 0.2×7.5 + 0.2×0.5 + 0.15×1 + 0.15×6
    // = 0 + 1.5 + 0.1 + 0.15 + 0.9 = 2.65
    expect(s.overall).toBeCloseTo(2.65, 5)
    expect(s.overall).toBeLessThanOrEqual(3)
  })
})

describe("calculateProposalScores — clamp boundaries", () => {
  it("savingsPercent = 30 clamps costSavings to 10 (upper bound)", () => {
    // 30% saved → raw score = 15 → clamp → 10.
    const s = calculateProposalScores(
      baseInput({ proposedAnnualSpend: 350_000, currentSpend: 500_000 }),
    )
    expect(s.costSavings).toBe(10)
  })

  it("savingsPercent = -5 clamps costSavings to 0 (lower bound)", () => {
    // Proposed > current → negative savings → raw negative → clamp → 0.
    const s = calculateProposalScores(
      baseInput({ proposedAnnualSpend: 525_000, currentSpend: 500_000 }),
    )
    expect(s.costSavings).toBe(0)
  })

  it("priceVsMarket = -20 clamps priceCompetitiveness to 0 (lower bound)", () => {
    const s = calculateProposalScores(baseInput({ priceVsMarket: -20 }))
    expect(s.priceCompetitiveness).toBe(0)
  })

  it("priceVsMarket = +20 clamps priceCompetitiveness to 10 (upper bound)", () => {
    const s = calculateProposalScores(baseInput({ priceVsMarket: 20 }))
    expect(s.priceCompetitiveness).toBe(10)
  })
})

describe("calculateProposalScores — lock-in penalty is additive", () => {
  it("termYears > 3 alone costs 2 points (score = 8)", () => {
    const s = calculateProposalScores(baseInput({ termYears: 4 }))
    expect(s.lockInRisk).toBe(8)
  })

  it("exclusivity alone costs 3 points (score = 7)", () => {
    const s = calculateProposalScores(baseInput({ exclusivity: true }))
    expect(s.lockInRisk).toBe(7)
  })

  it("marketShareCommitment > 70 alone costs 2 points (score = 8)", () => {
    const s = calculateProposalScores(
      baseInput({ marketShareCommitment: 75 }),
    )
    expect(s.lockInRisk).toBe(8)
  })

  it("marketShareCommitment exactly 70 does not penalize", () => {
    // Boundary: rule says `> 70`, so 70 is safe.
    const s = calculateProposalScores(
      baseInput({ marketShareCommitment: 70 }),
    )
    expect(s.lockInRisk).toBe(10)
  })

  it("minimumSpendIsHighPct alone costs 2 points (score = 8)", () => {
    const s = calculateProposalScores(
      baseInput({ minimumSpendIsHighPct: true }),
    )
    expect(s.lockInRisk).toBe(8)
  })

  it("all four penalties stack to 9 → score = 1", () => {
    const s = calculateProposalScores(
      baseInput({
        termYears: 5,
        exclusivity: true,
        marketShareCommitment: 80,
        minimumSpendIsHighPct: true,
      }),
    )
    expect(s.lockInRisk).toBe(1)
  })

  it("penalty never drives score below 0", () => {
    // Engineering more penalties than 10 isn't possible with current
    // rules (max 9), but the floor is part of the formula semantics.
    const s = calculateProposalScores(
      baseInput({
        termYears: 10,
        exclusivity: true,
        marketShareCommitment: 100,
        minimumSpendIsHighPct: true,
      }),
    )
    expect(s.lockInRisk).toBeGreaterThanOrEqual(0)
  })
})

describe("calculateProposalScores — TCO", () => {
  it("baseline TCO (no extras) = 6", () => {
    const s = calculateProposalScores(baseInput())
    expect(s.tco).toBe(6)
  })

  it("all three TCO extras = 10 (capped)", () => {
    const s = calculateProposalScores(
      baseInput({
        priceProtection: true,
        paymentTermsNet60Or90: true,
        volumeDiscountAbove5Percent: true,
      }),
    )
    expect(s.tco).toBe(10)
  })

  it("priceProtection alone adds 2 (TCO = 8)", () => {
    const s = calculateProposalScores(baseInput({ priceProtection: true }))
    expect(s.tco).toBe(8)
  })
})

describe("calculateProposalScores — edge cases", () => {
  it("currentSpend = 0 → costSavings = 0 (no divide-by-zero)", () => {
    const s = calculateProposalScores(
      baseInput({ currentSpend: 0, proposedAnnualSpend: 100_000 }),
    )
    expect(s.costSavings).toBe(0)
    expect(Number.isFinite(s.overall)).toBe(true)
  })

  it("minimumSpend = 0 → rebateAttainability = 10 (trivially attainable)", () => {
    const s = calculateProposalScores(baseInput({ minimumSpend: 0 }))
    expect(s.rebateAttainability).toBe(10)
  })
})

describe("calculateProposalScores — overall is exact weighted sum", () => {
  it("matches hand-computed weighted formula for mid-tier scores", () => {
    // Hand-computed inputs that yield clean integer component scores:
    //   savingsPercent = 10 → costSavings = 5
    //   priceVsMarket = 0  → priceCompetitiveness = 5
    //   currentSpend / minSpend = 1 → rebate = 5
    //   no lock-in penalties → lockIn = 10
    //   baseline TCO = 6
    // overall = 0.30×5 + 0.20×5 + 0.20×5 + 0.15×10 + 0.15×6
    //         = 1.5 + 1.0 + 1.0 + 1.5 + 0.9 = 5.9
    const s = calculateProposalScores(
      baseInput({
        proposedAnnualSpend: 450_000,
        currentSpend: 500_000,
        priceVsMarket: 0,
        minimumSpend: 500_000,
      }),
    )
    expect(s.costSavings).toBe(5)
    expect(s.priceCompetitiveness).toBe(5)
    expect(s.rebateAttainability).toBe(5)
    expect(s.lockInRisk).toBe(10)
    expect(s.tco).toBe(6)

    const expected =
      SCORE_WEIGHTS.costSavings * s.costSavings +
      SCORE_WEIGHTS.priceCompetitiveness * s.priceCompetitiveness +
      SCORE_WEIGHTS.rebateAttainability * s.rebateAttainability +
      SCORE_WEIGHTS.lockInRisk * s.lockInRisk +
      SCORE_WEIGHTS.tco * s.tco
    expect(s.overall).toBeCloseTo(expected, 10)
    expect(s.overall).toBeCloseTo(5.9, 10)
  })

  it("weights sum to 1", () => {
    const total =
      SCORE_WEIGHTS.costSavings +
      SCORE_WEIGHTS.priceCompetitiveness +
      SCORE_WEIGHTS.rebateAttainability +
      SCORE_WEIGHTS.lockInRisk +
      SCORE_WEIGHTS.tco
    expect(total).toBeCloseTo(1, 10)
  })
})
