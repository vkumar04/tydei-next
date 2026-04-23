"use client"

import Link from "next/link"
import { Calculator, ChevronRight, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatCurrency } from "@/lib/formatting"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

/**
 * Per-contract tier-progress list — extracted from the old
 * optimizer-client to keep the orchestrator under 400 lines.
 *
 * Each row shows the contract name, current tier badge, spend vs.
 * next-tier threshold with a progress bar, and an opportunity callout
 * with a Quick Win / Moderate / Long Term badge (theme-token colors).
 */
export interface ContractsTierProgressProps {
  contracts: RebateOpportunity[]
  onOpenCalculator: (opp: RebateOpportunity) => void
}

export function ContractsTierProgress({
  contracts,
  onOpenCalculator,
}: ContractsTierProgressProps) {
  if (contracts.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No rebate opportunities found.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {contracts.map((contract) => {
        const progressToNext = contract.percentToNextTier
        const urgency =
          contract.percentToNextTier >= 70
            ? "quick"
            : contract.percentToNextTier >= 40
              ? "moderate"
              : "long"

        return (
          <div
            key={`${contract.contractId}-${contract.currentTier}`}
            className="p-4 rounded-lg border bg-card"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold">{contract.contractName}</h4>
                  <Badge variant="outline">
                    Tier {contract.currentTier} &rarr; {contract.nextTier}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {contract.vendorName}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Current Rebate
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {contract.currentRebatePercent}%
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>
                  Current spend:{" "}
                  <span className="font-medium tabular-nums">
                    {formatCurrency(contract.currentSpend)}
                  </span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  Next tier: {formatCurrency(contract.nextTierThreshold)} (
                  {contract.nextTier}%)
                </span>
              </div>

              <Progress
                value={Math.min(progressToNext, 100)}
                className="h-3"
              />

              {contract.spendGap > 0 && (
                <div className="mt-4 p-3 rounded-lg border bg-muted/40">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium truncate">
                        {formatCurrency(contract.spendGap)} more to unlock{" "}
                        {contract.nextTier}% rebate
                      </span>
                    </div>
                    <Badge
                      variant="secondary"
                      className={
                        urgency === "quick"
                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                          : urgency === "moderate"
                            ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                            : ""
                      }
                    >
                      {urgency === "quick"
                        ? "Quick Win"
                        : urgency === "moderate"
                          ? "Moderate"
                          : "Long Term"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Potential additional rebate:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {formatCurrency(contract.projectedAdditionalRebate)}
                    </span>
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenCalculator(contract)}
              >
                <Calculator className="mr-2 h-4 w-4" />
                Calculate
              </Button>
              <Button size="sm" asChild>
                <Link href={`/dashboard/contracts/${contract.contractId}`}>
                  View Contract
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
