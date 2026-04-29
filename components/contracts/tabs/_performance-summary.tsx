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
  evaluationPeriod,
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
  /**
   * Charles 2026-04-28: drives the subtitle so a quarterly contract
   * doesn't read "Monthly spend on this contract." The synthetic-
   * periods fallback in `getContractPeriods` still buckets monthly;
   * this prop makes the cadence label match the term's evaluation
   * period the user actually configured.
   */
  evaluationPeriod?: "monthly" | "quarterly" | "semi_annual" | "annual" | null
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
            {(() => {
              const cadenceLabel =
                evaluationPeriod === "quarterly"
                  ? "Monthly spend on this contract; tiers evaluate per quarter"
                  : evaluationPeriod === "semi_annual"
                    ? "Monthly spend on this contract; tiers evaluate twice a year"
                    : evaluationPeriod === "annual"
                      ? "Monthly spend on this contract; tiers evaluate annually"
                      : "Monthly spend on this contract"
              return `${cadenceLabel} (last ${sorted.length} ${sorted.length === 1 ? "period" : "periods"}). Bar length is % of total contract value; dollar amount is actual spend this period.`
            })()}
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
          {evaluationPeriod && evaluationPeriod !== "monthly" && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tiers evaluate{" "}
              {evaluationPeriod === "quarterly"
                ? "per quarter"
                : evaluationPeriod === "semi_annual"
                  ? "every six months"
                  : "annually"}
              ; rolled-up rows below combine the underlying monthly buckets so
              tier qualification matches the term cadence.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(() => {
              // Charles 2026-04-28: when the term is quarterly/semi/annual,
              // roll the (monthly) period rows up into evaluation-period
              // buckets so tier qualification matches what the engine
              // actually does. Without this, a quarterly term with $86K/mo
              // looks like every month is below a $50K-but-quarterly tier
              // (it's not — quarterly spend is $258K).
              if (
                !evaluationPeriod ||
                evaluationPeriod === "monthly" ||
                sorted.length === 0
              ) {
                return sorted
              }
              const widthMonths =
                evaluationPeriod === "quarterly"
                  ? 3
                  : evaluationPeriod === "semi_annual"
                    ? 6
                    : 12
              const buckets = new Map<
                string,
                {
                  id: string
                  periodStart: Date
                  periodEnd: Date
                  totalSpend: number
                  rebateEarned: number
                  tierAchieved: number | null
                }
              >()
              for (const p of sorted) {
                const start = new Date(p.periodStart)
                const y = start.getUTCFullYear()
                const m = start.getUTCMonth() // 0-11
                let bucketIdx: number
                if (widthMonths === 3) bucketIdx = Math.floor(m / 3)
                else if (widthMonths === 6) bucketIdx = Math.floor(m / 6)
                else bucketIdx = 0
                const key = `${y}-${bucketIdx}`
                const bStartMonth = bucketIdx * widthMonths
                const bStart = new Date(Date.UTC(y, bStartMonth, 1))
                const bEnd = new Date(
                  Date.UTC(y, bStartMonth + widthMonths, 0),
                )
                const existing = buckets.get(key)
                if (existing) {
                  existing.totalSpend += Number(p.totalSpend ?? 0)
                  existing.rebateEarned += Number(p.rebateEarned ?? 0)
                } else {
                  buckets.set(key, {
                    id: `rollup-${key}`,
                    periodStart: bStart,
                    periodEnd: bEnd,
                    totalSpend: Number(p.totalSpend ?? 0),
                    rebateEarned: Number(p.rebateEarned ?? 0),
                    tierAchieved: null,
                  })
                }
              }
              return Array.from(buckets.values()).sort(
                (a, b) =>
                  a.periodStart.getTime() - b.periodStart.getTime(),
              )
            })().map((p) => {
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
