"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getContractPeriods } from "@/lib/actions/contract-periods"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

type PeriodData = Awaited<ReturnType<typeof getContractPeriods>>[number]

export function PerformanceSummary({
  periods,
  totalValue,
  contractTiers,
}: {
  periods: PeriodData[]
  totalValue: number
  /**
   * Charles 2026-04-25: tier ladder from the contract's first
   * tiered term. The Tier Achievement panel now derives each
   * period's tier from the period's `totalSpend` against this
   * ladder rather than reading `period.tierAchieved` directly,
   * which can be stale or inconsistent with the timeline.
   */
  contractTiers: Array<{ tierNumber: number; spendMin: number }>
}) {
  if (periods.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No performance data available yet. Add contract periods to see
          performance metrics.
        </CardContent>
      </Card>
    )
  }

  const sorted = [...periods].sort(
    (a, b) =>
      new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime(),
  )

  // Charles W1.W-C2: chart labels — the bare "Spend by Period" title
  // wasn't specific enough. Users asked "spend of what?". Now the
  // subtitle clarifies the scope (this contract only, last N periods),
  // the bar value shows the dollar amount alongside the "% of contract
  // value" used to size the bar, and hovering the bar reveals a
  // tooltip that names the biggest number (max spend period).
  const maxSpend = sorted.reduce(
    (m, p) => Math.max(m, Number(p.totalSpend)),
    0,
  )

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Spend Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Spend by Period</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Monthly spend on this contract (last {sorted.length}{" "}
            {sorted.length === 1 ? "period" : "periods"}). Bar length is % of
            total contract value; dollar amount is actual spend this period.
          </p>
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <div className="space-y-3">
              {sorted.map((p) => {
                const spend = Number(p.totalSpend)
                const pct =
                  totalValue > 0
                    ? Math.min(Math.round((spend / totalValue) * 100), 100)
                    : 0
                const isMax = maxSpend > 0 && spend === maxSpend
                return (
                  <Tooltip key={p.id}>
                    <TooltipTrigger asChild>
                      <div className="cursor-help space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            {formatCalendarDate(p.periodStart)} &ndash;{" "}
                            {formatCalendarDate(p.periodEnd)}
                          </span>
                          <span className="font-medium">
                            {formatCurrency(spend)}
                          </span>
                        </div>
                        <Progress value={pct} className="h-1.5" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px] p-3 text-xs">
                      <p className="font-medium">
                        {formatCalendarDate(p.periodStart)} – {formatCalendarDate(p.periodEnd)}
                      </p>
                      <p className="mt-1">
                        Spend on this contract only: {formatCurrency(spend)}
                        {totalValue > 0 && (
                          <>
                            {" "}
                            ({pct}% of contract total{" "}
                            {formatCurrency(totalValue)})
                          </>
                        )}
                      </p>
                      {isMax && sorted.length > 1 && (
                        <p className="mt-1 text-emerald-600">
                          Highest-spend period in view.
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>

      {/* Tier Achievement */}
      <Card>
        <CardHeader>
          <CardTitle>Tier Achievement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sorted.map((p) => {
              // Charles 2026-04-25: derive tier from this period's
              // actual totalSpend against the contract's ladder.
              // Falls back to p.tierAchieved if the contract has no
              // tiers (rare; legacy data).
              const periodSpend = Number(p.totalSpend)
              const periodEarned = Number(p.rebateEarned ?? 0)
              const sortedLadder = [...contractTiers].sort(
                (a, b) => a.spendMin - b.spendMin,
              )
              let derivedTier: number | null = null
              if (sortedLadder.length > 0) {
                for (const t of sortedLadder) {
                  if (periodSpend >= t.spendMin) derivedTier = t.tierNumber
                }
              }
              // Charles 2026-04-26 #82: fall back to the persisted
              // tierAchieved when the spend-vs-ladder walk produced
              // null. Volume-family terms (volume_rebate, rebate_per_use,
              // capitated_pricing_rebate) tier on CPT-occurrence counts
              // not dollar spend, so periodSpend < tier.spendMin doesn't
              // mean "no tier hit" — the tier was achieved via
              // occurrences and persisted on the period row.
              if (derivedTier == null && p.tierAchieved != null) {
                derivedTier = p.tierAchieved
              }
              // And when there's a single tier on the ladder and the
              // period earned rebate, the user expects Tier 1 — not N/A.
              if (
                derivedTier == null &&
                sortedLadder.length === 1 &&
                periodEarned > 0
              ) {
                derivedTier = sortedLadder[0].tierNumber
              }
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-sm text-muted-foreground">
                    {formatCalendarDate(p.periodStart)} &ndash;{" "}
                    {formatCalendarDate(p.periodEnd)}
                  </span>
                  <span className="text-sm font-medium">
                    {derivedTier != null ? `Tier ${derivedTier}` : "N/A"}
                  </span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
