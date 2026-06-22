/**
 * Plain-English summary for the vendor proposal analysis report — ties the
 * verdict, savings, rebate projection, and legal risk into one story so the
 * printed report leads with the narrative, not bare tables. Mirrors
 * `buildNarrative` on the Current State analysis export (Vick 2026-06-22 "the
 * report does not really tell the story of the data" → same treatment on the
 * prospective side).
 *
 * Pure + defensive: every input is optional (the analyzer fills them
 * incrementally as the user uploads the contract / price file), so each clause
 * only appears when its data is present.
 */

import { formatCurrency } from "@/lib/formatting"
import type { ProposalVerdict } from "@/lib/prospective-analysis/proposal-verdict"
import type { PricingFileAnalysis } from "@/lib/prospective-analysis/pricing-file-analysis"
import type { VendorLookbackComparison } from "@/lib/actions/prospective-analysis"
import type { PDFContractAnalysisResult } from "@/lib/contracts/clause-risk-analyzer"
import type { ScoredProposal } from "./types"

const VERDICT_PHRASE: Record<ProposalVerdict["verdict"], string> = {
  good_deal: "a good deal",
  negotiate: "worth negotiating",
  decline: "a decline",
}

export interface ProposalNarrativeInput {
  vendorName: string | null
  verdict: ProposalVerdict | null
  scored: ScoredProposal | null
  lookback: VendorLookbackComparison | null
  pricing: PricingFileAnalysis | null
  legal: PDFContractAnalysisResult | null
}

export function buildProposalNarrative(input: ProposalNarrativeInput): string {
  const { vendorName, verdict, scored, lookback, pricing, legal } = input
  const vendor = vendorName?.trim() || "this vendor"
  const parts: string[] = []

  // Opening — verdict + term score.
  const score = scored
    ? ` It scores ${scored.result.scores.overall.toFixed(1)}/10 on contract terms.`
    : ""
  if (verdict) {
    parts.push(
      `The proposal from ${vendor} reads as ${VERDICT_PHRASE[verdict.verdict]} ` +
        `(${verdict.confidence} confidence).${score}`,
    )
  } else if (scored) {
    parts.push(
      `The proposal from ${vendor} scores ${scored.result.scores.overall.toFixed(1)}/10 on contract terms.`,
    )
  } else {
    parts.push(`Proposal analysis for ${vendor}.`)
  }

  // Pricing vs current cost.
  if (pricing) {
    const s = pricing.summary
    parts.push(
      `Against ${formatCurrency(s.totalCurrentAnnualSpend)} of current annual cost, the proposed ` +
        `pricing implies ${formatCurrency(s.potentialSavings)} of annual savings ` +
        `(${s.avgVariancePercent.toFixed(1)}% average variance across ${s.itemsWithCOGMatch} of ` +
        `${s.totalItems} matched lines).`,
    )
  }

  // 12-month lookback rebate projection.
  if (lookback && lookback.vendorId !== null && lookback.predicted) {
    const p = lookback.predicted
    parts.push(
      `On ${formatCurrency(lookback.trailing12moSpend)} of trailing-12-month spend it projects ` +
        `Tier ${p.tierAchieved} (${p.rebatePercent.toFixed(1)}%), about ` +
        `${formatCurrency(p.annualRebate)}/yr in rebates.`,
    )
  } else if (lookback && lookback.vendorId === null) {
    parts.push("This is a net-new vendor relationship — no existing contracts to compare against.")
  }

  // Legal language scan.
  if (legal) {
    const flags = legal.criticalFlags.length
    const risk = legal.overallRiskLevel.replace(/_/g, " ")
    parts.push(
      `The legal scan rates overall risk ${legal.overallRiskScore}/100 (${risk})` +
        (flags > 0
          ? `, with ${flags} critical flag${flags === 1 ? "" : "s"} to address.`
          : " with no critical flags."),
    )
  }

  // What would sharpen the read.
  if (verdict?.missingInputs && verdict.missingInputs.length > 0) {
    parts.push(`The read would firm up with ${verdict.missingInputs.join(", ")}.`)
  }

  return parts.join(" ")
}
