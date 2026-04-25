"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getThresholdOpportunities } from "@/lib/actions/contracts/threshold-optimizer"
import Link from "next/link"

/**
 * Charles 2026-04-25 (audit follow-up — per-rebate-type optimizer).
 *
 * Companion to the spend-rebate optimizer for `compliance_rebate` +
 * `market_share` term types. Both are threshold-based: a single
 * contract metric (% achieved) compared to a tier ladder, where
 * crossing the next tier unlocks a flat dollar payout per period.
 *
 * Each row surfaces "you're X% short of the next tier — Δ Y% gets
 * you Z annual uplift" with a deep-link to the contract's detail
 * page where the metric can be updated.
 */
export function ThresholdOpportunitiesCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["threshold-opportunities"],
    queryFn: () => getThresholdOpportunities(),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Compliance & Market-Share Opportunities</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (!data || data.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compliance & Market-Share Opportunities</CardTitle>
        <CardDescription>
          Threshold-based rebates: how close each contract is to its
          next tier, and the annual uplift unlocking that tier would
          deliver. Sorted by smallest gap first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.map((row) => {
          const atTopTier = row.metricGap == null
          const progressPct =
            row.nextTierThreshold != null
              ? Math.min(
                  100,
                  (row.currentMetricValue / row.nextTierThreshold) * 100,
                )
              : 100
          return (
            <div
              key={`${row.contractId}-${row.termId}`}
              className="space-y-2 rounded-md border p-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/dashboard/contracts/${row.contractId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.vendorName} — {row.contractName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.termName} ·{" "}
                    {row.metric === "currentMarketShare"
                      ? "Market share"
                      : "Compliance"}
                    {atTopTier ? " · at top tier" : ""}
                  </p>
                </div>
                <Badge variant={atTopTier ? "default" : "secondary"}>
                  Tier {row.currentTierNumber}
                </Badge>
              </div>
              <Progress value={progressPct} />
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs tabular-nums">
                <span>
                  Current:{" "}
                  <span className="font-medium">
                    {row.currentMetricValue.toFixed(1)}%
                  </span>
                </span>
                {row.nextTierThreshold != null && (
                  <span>
                    Next tier at:{" "}
                    <span className="font-medium">
                      {row.nextTierThreshold.toFixed(1)}%
                    </span>{" "}
                    <span className="text-muted-foreground">
                      ({row.metricGap!.toFixed(1)}% short)
                    </span>
                  </span>
                )}
                <span className="text-muted-foreground">
                  Now:{" "}
                  <span className="font-medium text-foreground">
                    {formatCurrency(row.currentRebatePerPeriod)}
                  </span>{" "}
                  / period
                </span>
                {row.annualUplift != null && row.annualUplift > 0 && (
                  <span className="text-emerald-600">
                    Unlocks:{" "}
                    <span className="font-medium">
                      +{formatCurrency(row.annualUplift)}
                    </span>{" "}
                    / year
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
