"use client"

import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/formatting"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

/**
 * Top-N recommendations list — used inside the Opportunities tab on
 * the rebate optimizer page. Shows ranked cards with the spend gap
 * and a "Take action" button that opens the rebate calculator.
 */
export interface OpportunitiesRecommendationsProps {
  opportunities: RebateOpportunity[]
  onOpenCalculator: (opp: RebateOpportunity) => void
  limit?: number
}

export function OpportunitiesRecommendations({
  opportunities,
  onOpenCalculator,
  limit = 5,
}: OpportunitiesRecommendationsProps) {
  const top = opportunities.slice(0, limit)

  if (top.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No ranked opportunities available yet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {top.map((opp, idx) => (
        <div
          key={`${opp.contractId}-rec-${idx}`}
          className="flex items-start gap-4 p-4 rounded-lg border bg-card"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums text-muted-foreground">
            {idx + 1}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium truncate">
              {opp.vendorName} — {opp.contractName}
            </h4>
            <p className="text-sm text-muted-foreground mt-1">
              Increase spend by{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(opp.spendGap)}
              </span>{" "}
              to reach Tier {opp.nextTier} and earn an additional{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(opp.projectedAdditionalRebate)}
              </span>{" "}
              in rebates.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Progress:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {opp.percentToNextTier.toFixed(0)}%
              </span>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenCalculator(opp)}
          >
            Take action
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  )
}
