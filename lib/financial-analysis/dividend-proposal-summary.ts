/**
 * Recompute a saved Dividend/DCF proposal's headline figures from its payload.
 *
 * `DividendProposal.verdict` / `.annualDividendImpact` / `.netPresentValue` /
 * `.paybackYears` / `.noiImpact` are a write-through cache of this function
 * over `payload`, never a second source of truth: a row written before an
 * engine change holds the old definition of the metric and nothing recomputes
 * it. Parses and delegates — no math of its own.
 */

import { dividendProposalImpactInputsSchema } from "@/lib/validators/dividend-proposals"
import {
  computePurchaseDividendImpact,
  lineItemsToProforma,
  DEFAULT_DIVIDEND_ASSUMPTIONS,
  type DividendAssumptions,
  type DividendVerdict,
  type PurchaseDividendImpact,
} from "./proforma-pnl"

export interface DividendProposalSummary {
  verdict: DividendVerdict
  noiImpact: number
  annualDividendImpact: number
  netPresentValue: number
  paybackYears: number | null
}

/**
 * The single owner of "which assumption set was this proposal priced under?".
 * The saved snapshot wins; a payload predating `payload.assumptions` was priced
 * with the defaults. Every surface calls this rather than inlining the fallback.
 */
export function resolveProposalAssumptions(payload: unknown): DividendAssumptions {
  const parsed = dividendProposalImpactInputsSchema.safeParse(payload)
  return parsed.success && parsed.data.assumptions
    ? parsed.data.assumptions
    : DEFAULT_DIVIDEND_ASSUMPTIONS
}

/** Full engine result for a stored payload, or null when it can no longer drive
 *  the engine. Never throws. */
export function computeDividendImpactFromPayload(
  payload: unknown,
): PurchaseDividendImpact | null {
  const parsed = dividendProposalImpactInputsSchema.safeParse(payload)
  if (!parsed.success) return null
  return computePurchaseDividendImpact(
    lineItemsToProforma(parsed.data.lineItems),
    parsed.data.purchase,
    parsed.data.assumptions ?? DEFAULT_DIVIDEND_ASSUMPTIONS,
  )
}

/** The five denormalized columns, recomputed. Null = payload can't drive the engine. */
export function resolveDividendProposalSummary(
  payload: unknown,
): DividendProposalSummary | null {
  const impact = computeDividendImpactFromPayload(payload)
  if (!impact) return null
  return {
    verdict: impact.verdict,
    noiImpact: impact.noiImpact,
    annualDividendImpact: impact.annualDividendImpact,
    netPresentValue: impact.netPresentValue,
    paybackYears: impact.paybackYears,
  }
}
