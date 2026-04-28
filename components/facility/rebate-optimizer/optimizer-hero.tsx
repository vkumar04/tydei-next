"use client"

import { ArrowRight, Sparkles, Target, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

/**
 * Hero banner for the rebate-optimizer page. Mirrors `AnalysisHero`:
 *
 *   1. Label + headline + status badge (top row)
 *   2. Three big-number KPIs separated by `border-y py-6`
 *   3. Best-opportunity callout on the right (narrative left column
 *      is reserved for AI insight headline when present, otherwise
 *      absorbs a short static narrative)
 *
 * Replaces the four `border-l-4 border-l-<color>` summary cards from
 * the old layout — same numbers, one elevated plane instead of a card
 * farm.
 */
export interface RebateOptimizerHeroStats {
  totalEarned: number
  totalPotential: number
  highUrgency: number
  contractCount: number
}

export interface RebateOptimizerHeroProps {
  stats: RebateOptimizerHeroStats
  bestOpportunity: RebateOpportunity | null
  /** Optional one-line AI headline to render above the bullets. */
  aiHeadline?: string | null
}

export function RebateOptimizerHero({
  stats,
  bestOpportunity,
  aiHeadline,
}: RebateOptimizerHeroProps) {
  const { totalEarned, totalPotential, highUrgency, contractCount } = stats

  const statusLabel =
    highUrgency > 0
      ? `${highUrgency} quick win${highUrgency === 1 ? "" : "s"}`
      : contractCount > 0
        ? "On track"
        : "No data"
  const statusTone =
    highUrgency > 0
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
      : contractCount > 0
        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
        : "bg-muted text-muted-foreground"

  const headline =
    aiHeadline ??
    (totalPotential > 0
      ? `Up to ${formatCurrency(totalPotential)} in additional rebates across ${contractCount} contracts.`
      : contractCount > 0
        ? `Tracking ${contractCount} tiered rebate contracts.`
        : "No tiered rebate contracts to optimize yet.")

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            Rebate Optimizer
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {headline}
          </h2>
        </div>
        <Badge
          variant="secondary"
          className={`text-sm font-medium ${statusTone}`}
        >
          {statusLabel}
        </Badge>
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-3">
        <HeroStat
          label="Earned YTD"
          value={formatCurrency(totalEarned)}
          sublabel={`from ${contractCount} contract${contractCount === 1 ? "" : "s"}`}
        />
        <HeroStat
          label="Potential Additional"
          value={formatCurrency(totalPotential)}
          sublabel="if all next tiers reached"
          tone={totalPotential > 0 ? "positive" : "muted"}
        />
        <HeroStat
          label="Close to Next Tier"
          value={highUrgency.toString()}
          sublabel={
            highUrgency > 0
              ? `contract${highUrgency === 1 ? "" : "s"} past 70% progress`
              : "no contracts near threshold"
          }
          tone={highUrgency > 0 ? "positive" : "muted"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ul className="space-y-2">
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <Target className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              Use the <strong>Scenarios</strong> tab to model what-if spend
              increases and compare outcomes before committing.
            </span>
          </li>
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              The <strong>Contracts</strong> tab shows per-contract tier
              progress; quick-win contracts are within reach of their next
              threshold.
            </span>
          </li>
        </ul>

        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5" />
            Best opportunity
          </div>
          {bestOpportunity ? (
            (() => {
              // 2026-04-28 strategic-direction §2.4 v0 UX port:
              // surface "spend $X → unlock $Y" + ROI prominently. The
              // action's RebateOpportunity type doesn't carry roi or
              // urgency, so compute inline; thresholds match v0's
              // (high <$100K, medium <$250K, else low).
              const spend = bestOpportunity.spendGap
              const upside = bestOpportunity.projectedAdditionalRebate
              const roi = spend > 0 ? (upside / spend) * 100 : 0
              const urgency: "high" | "medium" | "low" =
                spend < 100_000
                  ? "high"
                  : spend < 250_000
                    ? "medium"
                    : "low"
              return (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className="mt-1 truncate text-sm font-semibold"
                      title={bestOpportunity.contractName}
                    >
                      {bestOpportunity.contractName}
                    </p>
                    {urgency === "high" && (
                      <Badge
                        variant="secondary"
                        className="bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100"
                      >
                        Act now
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {bestOpportunity.vendorName}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed">
                    Spend{" "}
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatCurrency(spend)}
                    </span>{" "}
                    more →{" "}
                    <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(upside)}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      rebate at Tier {bestOpportunity.nextTier}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    ROI{" "}
                    <span className="font-semibold tabular-nums">
                      {roi.toFixed(1)}%
                    </span>
                  </p>
                </>
              )
            })()
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No standout opportunity right now.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

interface HeroStatProps {
  label: string
  value: string
  sublabel: string
  tone?: "positive" | "negative" | "muted"
}

function HeroStat({ label, value, sublabel, tone }: HeroStatProps) {
  const sublabelClass =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-700 dark:text-red-400"
        : "text-muted-foreground"
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
        {value}
      </p>
      <p className={`text-xs ${sublabelClass}`}>{sublabel}</p>
    </div>
  )
}
