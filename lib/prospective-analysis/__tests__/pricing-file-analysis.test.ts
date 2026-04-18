/**
 * Tests for analyzePricingFile — pricing-file analyzer (spec §subsystem-2).
 *
 * Covers: empty input, fully-matched items, fully-unmatched items,
 * mixed match, savings-opportunity gating (only when variance<0 AND
 * qty>0), null-qty handling, summary counts + totals, and avg
 * variance % across matched items only.
 */

import { describe, it, expect } from "vitest"
import {
  analyzePricingFile,
  type PricingFileItem,
} from "../pricing-file-analysis"

function item(
  itemNumber: string,
  proposedPrice: number,
  currentPrice: number | null | undefined,
  estimatedAnnualQty: number | null | undefined = 100,
  description = `desc-${itemNumber}`,
): PricingFileItem {
  return {
    itemNumber,
    description,
    proposedPrice,
    currentPrice,
    estimatedAnnualQty,
  }
}

describe("analyzePricingFile", () => {
  it("empty input returns zero summary + empty lines", () => {
    const result = analyzePricingFile([])
    expect(result.lines).toEqual([])
    expect(result.summary).toEqual({
      totalItems: 0,
      itemsWithCOGMatch: 0,
      itemsWithoutCOGMatch: 0,
      avgVariancePercent: 0,
      totalProposedAnnualSpend: 0,
      totalCurrentAnnualSpend: 0,
      potentialSavings: 0,
      itemsBelowCOG: 0,
      itemsAboveCOG: 0,
    })
  })

  it("all items matched — computes variance, variancePercent, savings", () => {
    const result = analyzePricingFile([
      item("A", 8, 10, 100), // -2 variance, -20%, savings = 200
      item("B", 12, 10, 50), // +2 variance, +20%, no savings
    ])
    const [a, b] = result.lines
    expect(a?.variance).toBe(-2)
    expect(a?.variancePercent).toBe(-20)
    expect(a?.savingsOpportunity).toBe(200)
    expect(b?.variance).toBe(2)
    expect(b?.variancePercent).toBe(20)
    expect(b?.savingsOpportunity).toBeNull()
    expect(result.summary.itemsWithCOGMatch).toBe(2)
    expect(result.summary.itemsWithoutCOGMatch).toBe(0)
    expect(result.summary.itemsBelowCOG).toBe(1)
    expect(result.summary.itemsAboveCOG).toBe(1)
    expect(result.summary.avgVariancePercent).toBe(0) // (-20 + 20) / 2
    expect(result.summary.potentialSavings).toBe(200)
  })

  it("all items unmatched — variance/pct/savings all null, spend-current = 0", () => {
    const result = analyzePricingFile([
      item("A", 8, null, 100),
      item("B", 12, undefined, 50),
    ])
    for (const line of result.lines) {
      expect(line.currentPrice).toBeNull()
      expect(line.variance).toBeNull()
      expect(line.variancePercent).toBeNull()
      expect(line.savingsOpportunity).toBeNull()
    }
    expect(result.summary.itemsWithCOGMatch).toBe(0)
    expect(result.summary.itemsWithoutCOGMatch).toBe(2)
    expect(result.summary.totalCurrentAnnualSpend).toBe(0)
    expect(result.summary.totalProposedAnnualSpend).toBe(8 * 100 + 12 * 50)
    expect(result.summary.avgVariancePercent).toBe(0)
    expect(result.summary.potentialSavings).toBe(0)
    expect(result.summary.itemsBelowCOG).toBe(0)
    expect(result.summary.itemsAboveCOG).toBe(0)
  })

  it("mixed matched/unmatched — summary counts + spend totals", () => {
    const result = analyzePricingFile([
      item("A", 8, 10, 100), // matched, below
      item("B", 12, 10, 50), // matched, above
      item("C", 5, null, 200), // unmatched
      item("D", 10, 10, 10), // matched, equal (variance=0 → neither below nor above)
    ])
    expect(result.summary.totalItems).toBe(4)
    expect(result.summary.itemsWithCOGMatch).toBe(3)
    expect(result.summary.itemsWithoutCOGMatch).toBe(1)
    expect(result.summary.itemsBelowCOG).toBe(1)
    expect(result.summary.itemsAboveCOG).toBe(1)
    // Proposed spend = 8×100 + 12×50 + 5×200 + 10×10 = 800+600+1000+100 = 2500
    expect(result.summary.totalProposedAnnualSpend).toBe(2500)
    // Current spend (matched only) = 10×100 + 10×50 + 10×10 = 1000+500+100 = 1600
    expect(result.summary.totalCurrentAnnualSpend).toBe(1600)
  })

  it("savingsOpportunity requires variance<0 AND qty>0", () => {
    const result = analyzePricingFile([
      item("A", 8, 10, 100), // -2 × 100 = 200 savings
      item("B", 8, 10, 0), // qty=0 → null
      item("C", 8, 10, null), // qty null → null
      item("D", 12, 10, 100), // variance>0 → null
      item("E", 10, 10, 100), // variance=0 → null
    ])
    const [a, b, c, d, e] = result.lines
    expect(a?.savingsOpportunity).toBe(200)
    expect(b?.savingsOpportunity).toBeNull()
    expect(c?.savingsOpportunity).toBeNull()
    expect(d?.savingsOpportunity).toBeNull()
    expect(e?.savingsOpportunity).toBeNull()
    expect(result.summary.potentialSavings).toBe(200)
  })

  it("null qty contributes 0 to proposed annual spend", () => {
    const result = analyzePricingFile([item("A", 8, 10, null)])
    expect(result.summary.totalProposedAnnualSpend).toBe(0)
    expect(result.summary.totalCurrentAnnualSpend).toBe(0)
  })

  it("avgVariancePercent averages only matched items", () => {
    const result = analyzePricingFile([
      item("A", 5, 10, 100), // -50%
      item("B", 15, 10, 100), // +50%
      item("C", 5, 10, 100), // -50%
      item("D", 999, null, 100), // unmatched — should NOT pull the average
    ])
    // avg over matched three: (-50 + 50 + -50) / 3 = -50/3
    expect(result.summary.avgVariancePercent).toBeCloseTo(-50 / 3, 10)
  })

  it("variance sign drives itemsBelowCOG vs itemsAboveCOG; equal is neither", () => {
    const result = analyzePricingFile([
      item("A", 5, 10, 10),
      item("B", 5, 10, 10),
      item("C", 15, 10, 10),
      item("D", 10, 10, 10),
    ])
    expect(result.summary.itemsBelowCOG).toBe(2)
    expect(result.summary.itemsAboveCOG).toBe(1)
  })

  it("potentialSavings sums only negative-variance matched items with qty>0", () => {
    const result = analyzePricingFile([
      item("A", 2, 10, 100), // savings 800
      item("B", 5, 10, 50), // savings 250
      item("C", 5, 10, 0), // qty=0 skipped
      item("D", 20, 10, 1000), // above COG skipped
    ])
    expect(result.summary.potentialSavings).toBe(1050)
  })

  it("echoes itemNumber, description, proposedPrice, qty on each line", () => {
    const input = [item("ABC-123", 7.5, 10, 42, "the widget")]
    const result = analyzePricingFile(input)
    const line = result.lines[0]!
    expect(line.itemNumber).toBe("ABC-123")
    expect(line.description).toBe("the widget")
    expect(line.proposedPrice).toBe(7.5)
    expect(line.estimatedAnnualQty).toBe(42)
    expect(line.currentPrice).toBe(10)
  })

  it("handles currentPrice=0 without NaN/Infinity in variancePercent", () => {
    // Defensive: caller shouldn't pass 0 as a real COG, but if they do,
    // the module must not emit NaN (it would poison summary avg).
    const result = analyzePricingFile([item("A", 5, 0, 10)])
    const line = result.lines[0]!
    expect(line.currentPrice).toBe(0)
    expect(line.variance).toBe(5)
    expect(Number.isFinite(line.variancePercent ?? 0)).toBe(true)
    expect(Number.isFinite(result.summary.avgVariancePercent)).toBe(true)
  })

  it("line ordering mirrors input ordering", () => {
    const result = analyzePricingFile([
      item("C", 5, 10, 10),
      item("A", 5, 10, 10),
      item("B", 5, null, 10),
    ])
    expect(result.lines.map((l) => l.itemNumber)).toEqual(["C", "A", "B"])
  })
})
