"use client"

import { Activity, ArrowUpRight, CheckCircle2, Target } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatPerfCurrency } from "./performance-types"

/**
 * Hero banner for the vendor Performance page. Mirrors `AnalysisHero` /
 * `RebateOptimizerHero`:
 *
 *   1. Label + headline + status pill based on average compliance band
 *   2. Four hero KPIs separated by `border-y py-6` (Total Spend,
 *      Rebates Paid, Avg Compliance, Active Contracts)
 *   3. Narrative bullets left, "Best performing contract" callout right
 *
 * Replaces the four inline summary Cards at the top of the old layout.
 */
export interface PerformanceHeroProps {
  totalActualSpend: number
  totalTargetSpend: number
  totalRebatesPaid: number
  avgCompliance: number
  contractsExceeding: number
  contractsAtRisk: number
  contractCount: number
  facilityCount: number
  topContractName: string | null
  topContractFacility: string | null
  topContractRebate: number
}

type ComplianceBand = "strong" | "steady" | "watch"

function toBand(compliance: number, atRisk: number): ComplianceBand {
  if (atRisk > 0 && compliance < 90) return "watch"
  if (compliance >= 100) return "strong"
  return "steady"
}

const bandLabel: Record<ComplianceBand, string> = {
  strong: "Exceeding targets",
  steady: "On track",
  watch: "Needs attention",
}

const bandTone: Record<ComplianceBand, string> = {
  strong:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  steady:
    "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  watch:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
}

export function PerformanceHero({
  totalActualSpend,
  totalTargetSpend,
  totalRebatesPaid,
  avgCompliance,
  contractsExceeding,
  contractsAtRisk,
  contractCount,
  facilityCount,
  topContractName,
  topContractFacility,
  topContractRebate,
}: PerformanceHeroProps) {
  const band = toBand(avgCompliance, contractsAtRisk)
  const spendPct =
    totalTargetSpend > 0 ? (totalActualSpend / totalTargetSpend) * 100 : 0
  const effectiveRate =
    totalActualSpend > 0 ? (totalRebatesPaid / totalActualSpend) * 100 : 0

  const headline =
    contractCount > 0
      ? `${formatPerfCurrency(totalActualSpend)} delivered across ${contractCount} active contract${contractCount === 1 ? "" : "s"}.`
      : "No active contract performance data yet."

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            Performance
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {headline}
          </h2>
        </div>
        <Badge
          variant="secondary"
          className={`text-sm font-medium ${bandTone[band]}`}
        >
          {bandLabel[band]}
        </Badge>
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Total Spend"
          value={formatPerfCurrency(totalActualSpend)}
          sublabel={`${spendPct.toFixed(0)}% of ${formatPerfCurrency(totalTargetSpend)} target`}
          tone={spendPct >= 90 ? "positive" : "muted"}
        />
        <HeroStat
          label="Rebates Paid"
          value={formatPerfCurrency(totalRebatesPaid)}
          sublabel={`${effectiveRate.toFixed(1)}% effective rate`}
          tone={totalRebatesPaid > 0 ? "positive" : "muted"}
        />
        <HeroStat
          label="Avg Compliance"
          value={`${avgCompliance.toFixed(1)}%`}
          sublabel={`${contractsExceeding} exceeding, ${contractsAtRisk} at risk`}
          tone={avgCompliance >= 100 ? "positive" : avgCompliance >= 90 ? "muted" : "negative"}
        />
        <HeroStat
          label="Active Contracts"
          value={contractCount.toString()}
          sublabel={`across ${facilityCount} ${facilityCount === 1 ? "facility" : "facilities"}`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ul className="space-y-2">
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <Target className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              The <strong>Overview</strong> tab shows the monthly spend-vs-target
              trend and the multi-dimensional performance scorecard.
            </span>
          </li>
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              Use <strong>Rebate Progress</strong> to drill into tier attainment
              and filter by contract or facility.
            </span>
          </li>
        </ul>

        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ArrowUpRight className="h-3.5 w-3.5" />
            Top rebate earner
          </div>
          {topContractName ? (
            <>
              <p
                className="mt-2 truncate text-sm font-semibold"
                title={topContractName}
              >
                {topContractName}
              </p>
              <p className="text-xs text-muted-foreground">
                {topContractFacility}
              </p>
              <p className="mt-2 text-sm">
                <span className="font-semibold tabular-nums">
                  {formatPerfCurrency(topContractRebate)}
                </span>{" "}
                <span className="text-muted-foreground">rebates paid</span>
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No contract performance to highlight.
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
