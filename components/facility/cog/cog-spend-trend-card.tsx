"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { getCogSpendTrend } from "@/lib/actions/cog/spend-trend"

/**
 * Surfaces `classifySpendTrend` (v0 cogs-functionality.md §30) on the
 * COG Data page. Looks at the last 6 months of COG spend and reports
 * whether recent 3-month avg is trending up / down / stable vs the
 * prior 3-month avg. Only renders when there's enough data.
 */
export function CogSpendTrendCard({ facilityId }: { facilityId: string }) {
  const { data, isLoading } = useQuery({
    // Nested under "cog-records" so existing CRUD invalidations bust
    // this cache too (same rationale as the concentration card).
    queryKey: ["cog-records", "spend-trend", facilityId],
    queryFn: () => getCogSpendTrend(facilityId),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Spend trend</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (!data || data.monthlySpend.length < 6) return null
  // Defensive empty-state guard: if every month has zero spend, don't
  // render a card — there's no trend to report and percentages would
  // compute to NaN/Infinity on divide-by-zero. Also covers the case
  // where a cached response survives a full data wipe.
  const hasAnySpend = data.monthlySpend.some((m) => m > 0)
  if (!hasAnySpend) return null

  const { trend, changePct, recentAvg, priorAvg } = data
  const Icon = trend === "up" ? ArrowUp : trend === "down" ? ArrowDown : Minus
  const tone =
    trend === "up"
      ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
      : trend === "down"
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
        : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
  // Charles 2026-04-25 (Bug 15/16 — "hard codex / gibberish"): values
  // are real, but two big currencies were being crammed into one 1/3-
  // width grid cell and the display truncated to "$187,—" mid-number.
  // Switch to compact notation ($3.6M / $187K) so they always fit, and
  // split the cells in the layout below.
  const fmt = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    })
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Spend trend</CardTitle>
        <CardDescription>
          Last 3 months vs prior 3 months. Up = recent avg &gt;10% higher;
          down = &lt;-10% lower; else stable.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Direction</p>
          <Badge variant="secondary" className={`mt-1 text-xs ${tone}`}>
            <Icon className="mr-1 h-3 w-3" />
            {trend}
          </Badge>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Change</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {changePct >= 0 ? "+" : ""}
            {changePct.toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Recent 3-mo avg</p>
          <p className="mt-1 text-sm font-medium tabular-nums">
            {fmt(recentAvg)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Prior 3-mo avg</p>
          <p className="mt-1 text-sm font-medium tabular-nums">
            {fmt(priorAvg)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
