"use client"

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

/**
 * Fleet-wide rebate utilization (v0 doc §9 / contract-performance.ts).
 * Reduces every optimizer opportunity to a single "what % of the
 * top-tier rebate ceiling is the facility actually capturing?" number,
 * with the dollar gap broken out so the user can see how much
 * additional rebate is on the table.
 *
 * Math is in-component — same as v0RebateUtilization but vectorized
 * over all opportunities at once instead of one contract at a time
 * (the v0 helper is per-contract). Both routes converge: actual ÷
 * (currentSpend × topTierRate).
 */
export function RebateUtilizationSummary({
  opportunities,
}: {
  opportunities: RebateOpportunity[]
}) {
  const summary = useMemo(() => {
    let actualRebate = 0
    let maxPossibleRebate = 0
    let spendToReachCeiling = 0
    for (const o of opportunities) {
      actualRebate += (o.currentSpend * o.currentRebatePercent) / 100
      maxPossibleRebate += (o.currentSpend * o.topTierRebatePercent) / 100
      spendToReachCeiling += Math.max(0, o.topTierThreshold - o.currentSpend)
    }
    const utilizationPct =
      maxPossibleRebate > 0 ? (actualRebate / maxPossibleRebate) * 100 : 0
    return {
      actualRebate,
      maxPossibleRebate,
      missedRebate: Math.max(0, maxPossibleRebate - actualRebate),
      utilizationPct,
      spendToReachCeiling,
    }
  }, [opportunities])

  const utilTone =
    summary.utilizationPct >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : summary.utilizationPct >= 60
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400"

  const utilBar =
    summary.utilizationPct >= 80
      ? "[&>div]:bg-emerald-500"
      : summary.utilizationPct >= 60
        ? "[&>div]:bg-yellow-500"
        : "[&>div]:bg-red-500"

  if (opportunities.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Fleet-wide Rebate Utilization
          </CardTitle>
          <Badge
            className={
              summary.utilizationPct >= 80
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0"
                : summary.utilizationPct >= 60
                  ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-0"
                  : "bg-red-500/15 text-red-600 dark:text-red-400 border-0"
            }
          >
            {summary.utilizationPct.toFixed(1)}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className={`text-3xl font-bold ${utilTone}`}>
                {summary.utilizationPct.toFixed(0)}%
              </span>
              <span className="text-xs text-muted-foreground">
                of top-tier ceiling captured
              </span>
            </div>
            <Progress value={summary.utilizationPct} className={utilBar} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3 pt-2">
            <div>
              <p className="text-xs text-muted-foreground">Actual rebate</p>
              <p className="text-lg font-semibold">
                {formatCurrency(summary.actualRebate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Top-tier ceiling</p>
              <p className="text-lg font-semibold">
                {formatCurrency(summary.maxPossibleRebate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Missed rebate</p>
              <p className="text-lg font-semibold text-red-600 dark:text-red-400">
                {formatCurrency(summary.missedRebate)}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Additional spend to reach every contract&apos;s top tier:{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(summary.spendToReachCeiling)}
            </span>
            .
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
