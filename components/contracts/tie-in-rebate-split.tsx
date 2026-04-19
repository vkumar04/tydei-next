"use client"

/**
 * Tie-In rebate split widget (Wave A, A3).
 *
 * Renders `$X applied to capital | $Y cash rebate` beneath the
 * existing "Rebates Earned" card on tie-in contract detail pages.
 *
 * Split semantics mirror `calculateTieInCapital.trueUpAdjustment`
 * in lib/rebates/engine/tie-in-capital.ts: the engine defines
 *
 *   scheduledDue    = amortizationDue + carriedForwardShortfall
 *   trueUpAdjustment = scheduledDue - rebateEarned
 *     > 0 → facility short of scheduled paydown; the ENTIRE rebate
 *           applied to capital and there is still a shortfall
 *     < 0 → facility over-accrued; the excess becomes cash rebate
 *
 * Aggregated across elapsed periods this collapses to:
 *   appliedToCapital = min(rebateEarned, cumulativeScheduledDue)
 *   cashRebate       = max(0, rebateEarned - cumulativeScheduledDue)
 *
 * We reuse the already-computed schedule from getContractCapitalSchedule
 * (A1/A2) rather than re-running the engine — scheduledDue per period is
 * just amortizationDue from the schedule, and we have the elapsed count.
 */

import { useQuery } from "@tanstack/react-query"
import { HelpCircle } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatCurrency } from "@/lib/formatting"
import { getContractCapitalSchedule } from "@/lib/actions/contracts/tie-in"

interface TieInRebateSplitProps {
  contractId: string
  rebateEarned: number
}

export function TieInRebateSplit({
  contractId,
  rebateEarned,
}: TieInRebateSplitProps) {
  const { data } = useQuery({
    queryKey: ["contract-capital-schedule", contractId],
    queryFn: () => getContractCapitalSchedule(contractId),
  })

  // Without a schedule we can't compute the split — render nothing so
  // non-capital tie-in contracts keep their existing display.
  if (!data || !data.hasSchedule) return null

  const cumulativeScheduledDue = data.schedule
    .slice(0, data.elapsedPeriods)
    .reduce((acc, r) => acc + r.amortizationDue, 0)

  const appliedToCapital = Math.min(rebateEarned, cumulativeScheduledDue)
  const cashRebate = Math.max(0, rebateEarned - cumulativeScheduledDue)

  return (
    <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span>
        {formatCurrency(appliedToCapital)} applied to capital ·{" "}
        {formatCurrency(cashRebate)} cash rebate
      </span>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Rebate split explanation"
              className="inline-flex items-center text-muted-foreground hover:text-foreground"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs">
              Tie-in rebate is applied against the capital balance first
              (up to the scheduled amortization due across elapsed
              periods). Anything earned above that schedule flows through
              to the facility as a cash rebate.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </p>
  )
}
