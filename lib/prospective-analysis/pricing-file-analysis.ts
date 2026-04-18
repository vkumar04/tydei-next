/**
 * Prospective analysis — pricing-file analyzer (spec §subsystem-2,
 * docs/superpowers/specs/2026-04-18-prospective-analysis-rewrite.md).
 *
 * PURE FUNCTION: takes a list of pricing-file items (already joined
 * with COG current prices by the caller) and emits per-line variance +
 * a portfolio-level summary. No IO, no prisma imports.
 *
 * Variance math (per line):
 *   variance        = proposedPrice - currentPrice            (signed $/unit)
 *   variancePercent = (variance / currentPrice) × 100
 *   savingsOpp      = (currentPrice - proposedPrice) × estimatedAnnualQty
 *                     only when variance < 0 AND qty > 0; else null
 *
 * Missing COG match (currentPrice == null/undefined):
 *   variance, variancePercent, savingsOpportunity all null.
 *
 * Summary rules:
 *   avgVariancePercent = mean of variancePercent across matched items
 *                        (0 when there are no matched items — avoids NaN)
 *   totalProposedAnnualSpend = Σ proposedPrice × (qty ?? 0)         (all items)
 *   totalCurrentAnnualSpend  = Σ currentPrice × (qty ?? 0)           (matched only)
 *   potentialSavings         = Σ savingsOpportunity (when non-null)
 *   itemsBelowCOG / itemsAboveCOG count matched items only;
 *     variance === 0 is neither.
 */

export interface PricingFileItem {
  itemNumber: string
  description: string
  proposedPrice: number
  /** Optional current COG price — null if item isn't in COG history. */
  currentPrice?: number | null
  estimatedAnnualQty?: number | null
}

export interface PricingFileLineResult extends PricingFileItem {
  currentPrice: number | null
  variance: number | null
  variancePercent: number | null
  savingsOpportunity: number | null
}

export interface PricingFileSummary {
  totalItems: number
  itemsWithCOGMatch: number
  itemsWithoutCOGMatch: number
  avgVariancePercent: number
  totalProposedAnnualSpend: number
  totalCurrentAnnualSpend: number
  potentialSavings: number
  itemsBelowCOG: number
  itemsAboveCOG: number
}

export interface PricingFileAnalysis {
  lines: PricingFileLineResult[]
  summary: PricingFileSummary
}

function analyzeLine(item: PricingFileItem): PricingFileLineResult {
  const currentPrice =
    item.currentPrice === undefined || item.currentPrice === null
      ? null
      : item.currentPrice
  const qty =
    item.estimatedAnnualQty === undefined || item.estimatedAnnualQty === null
      ? null
      : item.estimatedAnnualQty

  if (currentPrice === null) {
    return {
      ...item,
      currentPrice: null,
      variance: null,
      variancePercent: null,
      savingsOpportunity: null,
    }
  }

  const variance = item.proposedPrice - currentPrice
  const variancePercent =
    currentPrice !== 0 ? (variance / currentPrice) * 100 : 0
  const savingsOpportunity =
    variance < 0 && qty !== null && qty > 0
      ? (currentPrice - item.proposedPrice) * qty
      : null

  return {
    ...item,
    currentPrice,
    variance,
    variancePercent,
    savingsOpportunity,
  }
}

export function analyzePricingFile(
  items: PricingFileItem[],
): PricingFileAnalysis {
  const lines = items.map(analyzeLine)

  let itemsWithCOGMatch = 0
  let itemsWithoutCOGMatch = 0
  let totalProposedAnnualSpend = 0
  let totalCurrentAnnualSpend = 0
  let potentialSavings = 0
  let itemsBelowCOG = 0
  let itemsAboveCOG = 0
  let varianceSum = 0
  let varianceCount = 0

  for (const line of lines) {
    const qty =
      line.estimatedAnnualQty === undefined || line.estimatedAnnualQty === null
        ? 0
        : line.estimatedAnnualQty

    totalProposedAnnualSpend += line.proposedPrice * qty

    if (line.currentPrice === null) {
      itemsWithoutCOGMatch++
      continue
    }

    itemsWithCOGMatch++
    totalCurrentAnnualSpend += line.currentPrice * qty

    if (line.variancePercent !== null) {
      varianceSum += line.variancePercent
      varianceCount++
    }

    if (line.variance !== null) {
      if (line.variance < 0) itemsBelowCOG++
      else if (line.variance > 0) itemsAboveCOG++
    }

    if (line.savingsOpportunity !== null) {
      potentialSavings += line.savingsOpportunity
    }
  }

  const avgVariancePercent = varianceCount > 0 ? varianceSum / varianceCount : 0

  return {
    lines,
    summary: {
      totalItems: lines.length,
      itemsWithCOGMatch,
      itemsWithoutCOGMatch,
      avgVariancePercent,
      totalProposedAnnualSpend,
      totalCurrentAnnualSpend,
      potentialSavings,
      itemsBelowCOG,
      itemsAboveCOG,
    },
  }
}
