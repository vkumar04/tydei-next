import { useMemo, useRef } from "react"
import type { PricingFileAnalysis } from "@/lib/prospective-analysis/pricing-file-analysis"
import type { ScoredProposal } from "../types"

/**
 * The mutable refs shared across the upload-proposal analysis session. The
 * two pipelines (price file and contract PDF) plus Start over all coordinate
 * through ONE instance of these — creating a second copy silently breaks the
 * reset-generation guard and the cross-order re-score behaviors
 * (pricing-then-PDF vs PDF-then-pricing).
 */
export interface AnalysisSessionRefs {
  /**
   * Bumped by Start over (bug-bash C1) so an in-flight analysis promise
   * that resolves AFTER the reset can't repopulate the cleared state —
   * each async path captures the generation at launch and bails if it
   * changed.
   */
  resetGenRef: { current: number }
  /**
   * Mirror of `selectedVendorId` for async callbacks (the lookback promise
   * resolves long after launch — the closure value would be stale).
   */
  selectedVendorIdRef: { current: string | null }
  /**
   * R2: which vendor the most recent lookback request was issued for —
   * stops the lookback re-fetch effect from retry-looping when a lookback
   * legitimately resolves to nothing for that selection.
   */
  lookbackRequestedVendorRef: { current: string | null }
  /**
   * Refs to feed price-vs-market into the deal score without stale closures /
   * dep churn (audit P1#6). `pricingAnalysisRef` lets the PDF handler read an
   * already-analyzed price file (pricing-then-PDF order); `lastScoredRef` +
   * `onProposalScoredRef` let the price-file handler re-score the existing
   * upload proposal (PDF-then-pricing order).
   */
  pricingAnalysisRef: { current: PricingFileAnalysis | null }
  lastScoredRef: { current: ScoredProposal | null }
  onProposalScoredRef: { current: (proposal: ScoredProposal) => void }
  /**
   * Which vendor drove the most recent COG join — lets the re-join effect
   * fire only when the analysis vendor actually changed.
   */
  lastPricingJoinVendorRef: { current: string | null }
}

/** Creates the ONE shared refs instance; call exactly once, in the tab. */
export function useAnalysisSessionRefs({
  selectedVendorId,
  lastScored,
  onProposalScored,
}: {
  selectedVendorId: string | null
  lastScored: ScoredProposal | null
  onProposalScored: (proposal: ScoredProposal) => void
}): AnalysisSessionRefs {
  const selectedVendorIdRef = useRef(selectedVendorId)
  selectedVendorIdRef.current = selectedVendorId

  const resetGenRef = useRef(0)

  const lookbackRequestedVendorRef = useRef<string | null>(null)

  const pricingAnalysisRef = useRef<PricingFileAnalysis | null>(null)
  const lastScoredRef = useRef(lastScored)
  lastScoredRef.current = lastScored
  const onProposalScoredRef = useRef(onProposalScored)
  onProposalScoredRef.current = onProposalScored

  const lastPricingJoinVendorRef = useRef<string | null>(null)

  // All seven refs are identity-stable for the component's lifetime, so the
  // session object is too — hook callbacks can safely list it in deps.
  return useMemo(
    () => ({
      resetGenRef,
      selectedVendorIdRef,
      lookbackRequestedVendorRef,
      pricingAnalysisRef,
      lastScoredRef,
      onProposalScoredRef,
      lastPricingJoinVendorRef,
    }),
    [
      resetGenRef,
      selectedVendorIdRef,
      lookbackRequestedVendorRef,
      pricingAnalysisRef,
      lastScoredRef,
      onProposalScoredRef,
      lastPricingJoinVendorRef,
    ],
  )
}
