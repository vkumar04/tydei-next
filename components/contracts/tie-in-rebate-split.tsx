"use client"

/**
 * Tie-In rebate split widget (Wave A, A3; Charles W1.Y-C revised).
 *
 * Renders `$X applied to capital · $Y cash rebate` beneath the existing
 * "Rebates Earned" card on tie-in contract detail pages.
 *
 * Charles's rule (iMessage 2026-04-20): on tie-in deals, 100% of
 * COLLECTED rebate retires the capital balance. Earned-but-uncollected
 * does not count as paid-down — only actually-collected dollars reduce
 * the balance. This widget now routes through the canonical
 * `sumRebateAppliedToCapital` helper
 * (`lib/contracts/rebate-capital-filter.ts`) via
 * `getContractCapitalSchedule.rebateAppliedToCapital` so the number here
 * matches the Capital Amortization card's "Rebates Applied (lifetime)".
 *
 * "Cash rebate" here is the portion of earned-not-yet-collected rebate
 * that would have exceeded the term's cumulative scheduled paydown —
 * i.e., the amount the facility might expect as cash once collected
 * above the retire-the-capital threshold. In practice under Charles's
 * 100%-to-capital rule this is typically $0 until the capital is
 * retired.
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

  // Charles W1.Y-C (C2): `appliedToCapital` now comes from the canonical
  // helper (via the server action) — collected rebate applied to the
  // capital balance. The cash-rebate piece is anything earned above the
  // total capital cost (i.e., once capital is fully retired). Under the
  // 100%-to-capital rule this is typically $0 while there is still a
  // balance due.
  const appliedToCapital = data.rebateAppliedToCapital
  const cashRebate = Math.max(0, rebateEarned - data.capitalCost)

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
              Tie-in deals retire the capital balance first: 100% of
              collected rebate is applied to capital until the balance is
              fully paid down. Anything earned above that flows through to
              the facility as a cash rebate.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </p>
  )
}
