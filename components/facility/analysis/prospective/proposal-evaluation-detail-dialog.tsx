"use client"

/**
 * Per-proposal View dialog for a saved facility evaluation (2026-06-26). Re-uses
 * the rich {@link ScoredProposalCard} (score / verdict / ScoreBars / negotiation
 * points / risks / dynamic tiers) so the full evaluation is reopenable from the
 * Proposals list, not only inline at score-time. Optional Re-run hands the
 * evaluation's saved input back to the Manual tab for editing + re-scoring.
 */

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { ScoredProposalCard } from "./scored-proposal-card"
import { ProposalVerdictCard } from "./proposal-verdict-card"
import { synthesizeProposalVerdict } from "@/lib/prospective-analysis/proposal-verdict"
import type { ScoredProposal } from "./types"

interface Props {
  proposal: ScoredProposal
  onClose: () => void
  /** Reopen this evaluation's inputs in the Manual tab to edit + re-score. */
  onRerun?: (proposal: ScoredProposal) => void
}

export function ProposalEvaluationDetailDialog({
  proposal,
  onClose,
  onRerun,
}: Props) {
  // Evaluations saved after F-C3 carry the score-time signal snapshots —
  // re-synthesize the SAME verdict the user saw (lookback / pricing / legal
  // included), instead of showing only the bare score card.
  const verdict = proposal.signals
    ? synthesizeProposalVerdict({
        scoreOverall: proposal.result.scores.overall,
        scoreVerdict: proposal.result.recommendation.verdict,
        pricing: proposal.signals.pricing,
        lookback: proposal.signals.lookback,
        legal: proposal.signals.legal,
      })
    : null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {proposal.vendorName} — proposal evaluation
          </DialogTitle>
        </DialogHeader>

        {verdict ? (
          <ProposalVerdictCard
            verdict={verdict}
            vendorName={proposal.vendorName}
          />
        ) : null}
        <ScoredProposalCard proposal={proposal} />

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {onRerun && (
            <Button
              onClick={() => {
                onRerun(proposal)
                onClose()
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Re-run / edit
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
