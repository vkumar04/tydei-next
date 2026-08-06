import { describe, it, expect } from "vitest"
import {
  isSpendDollarTerm,
  priceVsMarketFromAnalysis,
} from "../upload-proposal/scoring-helpers"
import type { PricingFileAnalysis } from "@/lib/prospective-analysis/pricing-file-analysis"

function analysis(
  avgVariancePercent: number,
  itemsWithCOGMatch = 5,
): PricingFileAnalysis {
  return {
    lines: [],
    summary: {
      totalItems: 5,
      itemsWithCOGMatch,
      itemsWithoutCOGMatch: 0,
      avgVariancePercent,
      totalProposedAnnualSpend: 0,
      totalCurrentAnnualSpend: 0,
      potentialSavings: 0,
      itemsBelowCOG: 0,
      itemsAboveCOG: 0,
    },
  }
}

// Guards the broadened spend-dollar term filter — the proposal lookback + the
// score's top-tier rate both gate on this. Before broadening, only
// {spend_rebate, growth_rebate, ""} matched, so the AI's varied spend-rebate
// labels were dropped and "tiers weren't picked up like contracts"
// (Vick 2026-06-22).
describe("isSpendDollarTerm", () => {
  it("includes the spend-dollar rebate family (incl. broadened labels)", () => {
    for (const t of [
      "spend_rebate",
      "growth_rebate",
      "percent_of_spend",
      "spend_based",
      "usage",
      "",
    ]) {
      expect(isSpendDollarTerm(t)).toBe(true)
    }
  })

  it("is case- and spacing-insensitive (AI emits 'Spend Rebate')", () => {
    expect(isSpendDollarTerm("Spend Rebate")).toBe(true)
    expect(isSpendDollarTerm("  PERCENT_OF_SPEND  ")).toBe(true)
    expect(isSpendDollarTerm("Spend Based")).toBe(true)
  })

  it("excludes non-spend-dollar types (they store %/count or pay per-SKU)", () => {
    for (const t of [
      "market_share",
      "volume_rebate",
      "carve_out",
      "fixed_rebate",
      "per_procedure_rebate",
    ]) {
      expect(isSpendDollarTerm(t)).toBe(false)
    }
  })

  it("treats null/undefined as the empty (default-in) case", () => {
    expect(isSpendDollarTerm(null)).toBe(true)
    expect(isSpendDollarTerm(undefined)).toBe(true)
  })
})

// The engine's priceVsMarket is POSITIVE when cheaper (locked by
// scoring.test.ts); the price file's avgVariancePercent is NEGATIVE when
// cheaper. This helper must negate so a cheaper proposal scores HIGHER (audit
// P1#6 — feeding it raw would have scored cheaper proposals lower).
describe("priceVsMarketFromAnalysis", () => {
  it("returns 0 when no analysis or no COG-matched lines", () => {
    expect(priceVsMarketFromAnalysis(null)).toBe(0)
    expect(priceVsMarketFromAnalysis(analysis(-5, 0))).toBe(0)
  })

  it("negates: a cheaper proposal (negative variance) → positive (good)", () => {
    expect(priceVsMarketFromAnalysis(analysis(-5))).toBe(5)
    expect(priceVsMarketFromAnalysis(analysis(-12.34))).toBe(12.3)
  })

  it("negates: a pricier proposal (positive variance) → negative (bad)", () => {
    expect(priceVsMarketFromAnalysis(analysis(8))).toBe(-8)
  })
})
