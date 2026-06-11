/**
 * Proposal verdict synthesizer (Charles 2026-06-10: "take the terms of a PDF
 * and the pricing file that is loaded and compare the pricing and terms to
 * what they have and figure out if it is good").
 *
 * PURE FUNCTION — combines the four independent analysis outputs (term
 * scoring, pricing-file variance vs COG, 12-month lookback vs existing
 * contracts, legal clause risk) into one verdict with explicit, numeric
 * reasons. No IO. Conservative by design: legal critical flags and
 * above-COG pricing can only pull the verdict DOWN, never up.
 */

export interface VerdictPricingSignal {
  /** Mean variance % across COG-matched lines (negative = cheaper). */
  avgVariancePercent: number
  potentialSavings: number
  itemsWithCOGMatch: number
  totalItems: number
  itemsAboveCOG: number
}

export interface VerdictLookbackSignal {
  trailing12moSpend: number
  /** Projection of the proposal's ladder on real trailing spend. */
  predictedAnnualRebate: number | null
  predictedRatePct: number | null
  /** Best effective rate across the vendor's existing contracts. */
  bestExistingEffectiveRatePct: number | null
  hasExistingContracts: boolean
}

export interface VerdictLegalSignal {
  /** 0-100 weighted aggregate from the canonical clause analyzer. */
  overallRiskScore: number
  overallRiskLevel: string
  criticalFlagCount: number
}

export interface ProposalVerdictInput {
  /** 0-10 overall from the scoring engine; null when scoring didn't run. */
  scoreOverall: number | null
  /** The scoring engine's own verdict. */
  scoreVerdict: "accept" | "negotiate" | "decline" | null
  pricing: VerdictPricingSignal | null
  lookback: VerdictLookbackSignal | null
  legal: VerdictLegalSignal | null
}

export type VerdictKind = "good_deal" | "negotiate" | "decline"

export interface VerdictReason {
  tone: "positive" | "negative" | "warning"
  text: string
}

export interface ProposalVerdict {
  verdict: VerdictKind
  /** high = all four signals present; medium = 2-3; low = 0-1. */
  confidence: "high" | "medium" | "low"
  reasons: VerdictReason[]
  /** What's missing — drives the "add the price file" style nudges. */
  missingInputs: string[]
}

const fmtUsd = (v: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v)

export function synthesizeProposalVerdict(
  input: ProposalVerdictInput,
): ProposalVerdict {
  const reasons: VerdictReason[] = []
  const missingInputs: string[] = []

  // ── Term scoring ──────────────────────────────────────────────────
  if (input.scoreOverall !== null && input.scoreVerdict !== null) {
    reasons.push({
      tone:
        input.scoreVerdict === "accept"
          ? "positive"
          : input.scoreVerdict === "decline"
            ? "negative"
            : "warning",
      text: `Term score ${input.scoreOverall.toFixed(1)}/10 (${input.scoreVerdict}).`,
    })
  } else {
    missingInputs.push("term scoring")
  }

  // ── Pricing vs current COG ────────────────────────────────────────
  let pricingBad = false
  if (input.pricing) {
    const p = input.pricing
    if (p.itemsWithCOGMatch === 0) {
      reasons.push({
        tone: "warning",
        text: `None of the ${p.totalItems} price-file lines matched your COG history — pricing impact is unverified.`,
      })
    } else if (p.avgVariancePercent <= 0) {
      reasons.push({
        tone: "positive",
        text: `Pricing averages ${Math.abs(p.avgVariancePercent).toFixed(1)}% BELOW your current cost (${p.itemsWithCOGMatch}/${p.totalItems} lines matched, ~${fmtUsd(p.potentialSavings)} potential savings).`,
      })
    } else {
      pricingBad = p.avgVariancePercent > 3
      reasons.push({
        tone: pricingBad ? "negative" : "warning",
        text: `Pricing averages ${p.avgVariancePercent.toFixed(1)}% ABOVE your current cost (${p.itemsAboveCOG} of ${p.itemsWithCOGMatch} matched lines cost more).`,
      })
    }
  } else {
    missingInputs.push("price file")
  }

  // ── Rebate terms vs what they have ────────────────────────────────
  let rebateWorse = false
  if (input.lookback) {
    const l = input.lookback
    if (l.trailing12moSpend === 0) {
      reasons.push({
        tone: "warning",
        text: "No spend with this vendor in the last 12 months — rebate projection has nothing to run against (net-new relationship).",
      })
    } else if (l.predictedRatePct === null) {
      reasons.push({
        tone: "negative",
        text: `At your current pace (${fmtUsd(l.trailing12moSpend)}/yr) the proposal's tiers pay $0 — the lowest threshold is out of reach.`,
      })
      rebateWorse = true
    } else if (
      l.bestExistingEffectiveRatePct !== null &&
      l.bestExistingEffectiveRatePct > 0
    ) {
      rebateWorse = l.predictedRatePct < l.bestExistingEffectiveRatePct
      reasons.push({
        tone: rebateWorse ? "negative" : "positive",
        text: `Projects ${l.predictedRatePct.toFixed(1)}% (${fmtUsd(l.predictedAnnualRebate ?? 0)}/yr) vs your existing contracts' best effective ${l.bestExistingEffectiveRatePct.toFixed(2)}%.`,
      })
    } else {
      reasons.push({
        tone: "positive",
        text: `Projects ${l.predictedRatePct.toFixed(1)}% (${fmtUsd(l.predictedAnnualRebate ?? 0)}/yr) on your real trailing-12-month spend${l.hasExistingContracts ? "" : " — no existing contracts to beat"}.`,
      })
    }
  } else {
    missingInputs.push("12-month lookback")
  }

  // ── Legal language ────────────────────────────────────────────────
  let legalCritical = false
  if (input.legal) {
    const g = input.legal
    legalCritical = g.criticalFlagCount > 0
    if (legalCritical) {
      reasons.push({
        tone: "negative",
        text: `${g.criticalFlagCount} critical legal flag${g.criticalFlagCount === 1 ? "" : "s"} in the contract language (overall risk ${g.overallRiskScore}/100, ${g.overallRiskLevel}).`,
      })
    } else if (g.overallRiskScore >= 50) {
      reasons.push({
        tone: "warning",
        text: `Contract language risk ${g.overallRiskScore}/100 (${g.overallRiskLevel}) — review the flagged clauses.`,
      })
    } else {
      reasons.push({
        tone: "positive",
        text: `Contract language risk ${g.overallRiskScore}/100 (${g.overallRiskLevel}).`,
      })
    }
  } else {
    missingInputs.push("legal clause scan")
  }

  // ── Verdict ───────────────────────────────────────────────────────
  const presentSignals = 4 - missingInputs.length
  const confidence: ProposalVerdict["confidence"] =
    presentSignals >= 4 ? "high" : presentSignals >= 2 ? "medium" : "low"

  let verdict: VerdictKind
  if (
    input.scoreVerdict === "decline" ||
    (input.legal?.criticalFlagCount ?? 0) >= 2
  ) {
    verdict = "decline"
  } else if (
    input.scoreVerdict === "accept" &&
    !legalCritical &&
    !pricingBad &&
    !rebateWorse
  ) {
    verdict = "good_deal"
  } else {
    verdict = "negotiate"
  }

  return { verdict, confidence, reasons, missingInputs }
}
