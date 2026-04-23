"use client"

import { AlertTriangle, Stethoscope } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatPercent } from "@/lib/formatting"

/**
 * Hero banner for the Case Costing page. Matches the "hero + tabs" pattern
 * shipped for Analysis, Rebate Optimizer, Contracts, and Dashboard.
 *
 *   1. Eyebrow + headline sentence (how many cases, what scope)
 *   2. Warning pill (cases with low compliance) when non-zero
 *   3. Four hero stats separated by `border-y py-6`:
 *        Total cases, Avg cost / case, Avg margin, On-contract rate
 */
export interface CaseCostingHeroProps {
  totalCases: number
  avgCostPerCase: number
  avgMarginPct: number
  onContractPct: number
  lowComplianceCases: number
  scopeLabel: string
  isLoading?: boolean
}

export function CaseCostingHero({
  totalCases,
  avgCostPerCase,
  avgMarginPct,
  onContractPct,
  lowComplianceCases,
  scopeLabel,
  isLoading,
}: CaseCostingHeroProps) {
  const marginTone: "positive" | "negative" | "muted" =
    avgMarginPct > 0 ? "positive" : avgMarginPct < 0 ? "negative" : "muted"
  const complianceTone: "positive" | "negative" | "muted" =
    onContractPct >= 80 ? "positive" : onContractPct >= 50 ? "muted" : "negative"

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Stethoscope className="h-3.5 w-3.5" />
            Case Costing
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {isLoading ? (
              <Skeleton className="h-7 w-72" />
            ) : (
              <>
                {totalCases.toLocaleString()}{" "}
                {totalCases === 1 ? "case" : "cases"} costed
                {" · "}
                <span className="text-muted-foreground">{scopeLabel}</span>
              </>
            )}
          </h2>
        </div>
        {lowComplianceCases > 0 && (
          <Badge
            variant="secondary"
            className="gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {lowComplianceCases} low-compliance {lowComplianceCases === 1 ? "case" : "cases"}
          </Badge>
        )}
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Total Cases"
          value={isLoading ? null : totalCases.toLocaleString()}
          sublabel="Across current scope"
        />
        <HeroStat
          label="Avg Cost / Case"
          value={isLoading ? null : formatCurrency(avgCostPerCase)}
          sublabel="Supply + implant spend"
        />
        <HeroStat
          label="Avg Margin"
          value={isLoading ? null : formatPercent(avgMarginPct)}
          sublabel="Reimbursement − spend"
          tone={marginTone}
        />
        <HeroStat
          label="On-Contract Rate"
          value={isLoading ? null : formatPercent(onContractPct)}
          sublabel="Supply spend under contract"
          tone={complianceTone}
        />
      </div>
    </section>
  )
}

interface HeroStatProps {
  label: string
  value: string | null
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
      {value === null ? (
        <Skeleton className="h-9 w-28" />
      ) : (
        <p className="text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
          {value}
        </p>
      )}
      <p className={`text-xs ${sublabelClass}`}>{sublabel}</p>
    </div>
  )
}
