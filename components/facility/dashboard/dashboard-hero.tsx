"use client"

/**
 * Facility dashboard — hero banner.
 *
 * Collapses the previous 6-card KPI grid into one elevated, scannable
 * top-of-page unit that matches the Analysis / Contracts / Rebate
 * Optimizer / AI Assistant pattern shipped earlier in April 2026:
 *
 *   1. Eyebrow + headline sentence ("$X spend tracked across N contracts")
 *   2. Warning pill (pending-alerts count) when non-zero
 *   3. Four hero stats separated by `border-y py-6`:
 *        Active Contracts, Total Spend, Rebates, Pending Alerts
 *      — the same four headings the E2E / visual specs key on.
 *
 * Sublabels carry the companion numbers (on-contract subset, collected
 * subset) so every signal the 6-card grid used to surface is still
 * visible, just compressed into four denser panels.
 */

import { AlertTriangle, LayoutDashboard } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"

export interface DashboardHeroProps {
  totalContracts: number
  activeContracts: number
  totalContractValue: number
  totalSpendYTD: number
  onContractSpendYTD: number
  totalRebatesEarned: number
  totalRebatesCollected: number
  pendingAlerts: number
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%"
  const pct = (part / whole) * 100
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`
}

export function DashboardHero({
  totalContracts,
  activeContracts,
  totalContractValue,
  totalSpendYTD,
  onContractSpendYTD,
  totalRebatesEarned,
  totalRebatesCollected,
  pendingAlerts,
}: DashboardHeroProps) {
  const onContractPct = percent(onContractSpendYTD, totalSpendYTD)
  const collectionRate = percent(totalRebatesCollected, totalRebatesEarned)

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <LayoutDashboard className="h-3.5 w-3.5" />
            Facility overview
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {formatCurrency(totalSpendYTD)} YTD spend tracked across{" "}
            {formatCount(totalContracts)}{" "}
            {totalContracts === 1 ? "contract" : "contracts"}
            {" · "}
            <span className="text-muted-foreground">
              {formatCurrency(totalContractValue)} lifetime value
            </span>
          </h2>
        </div>
        {pendingAlerts > 0 && (
          <Badge
            variant="secondary"
            className="gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {pendingAlerts} pending alert{pendingAlerts === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Active Contracts"
          value={formatCount(activeContracts)}
          sublabel={`of ${formatCount(totalContracts)} total`}
          tone="positive"
        />
        <HeroStat
          label="Total Spend"
          value={formatCurrency(totalSpendYTD)}
          sublabel={`${formatCurrency(onContractSpendYTD)} On Contract · ${onContractPct} YTD spend`}
          tone={
            totalSpendYTD === 0
              ? "muted"
              : onContractSpendYTD / Math.max(totalSpendYTD, 1) >= 0.5
                ? "positive"
                : "negative"
          }
        />
        <HeroStat
          label="Rebates"
          value={formatCurrency(totalRebatesEarned)}
          sublabel={`${formatCurrency(totalRebatesCollected)} Collected · ${collectionRate} collection rate`}
          tone={
            totalRebatesEarned === 0
              ? "muted"
              : totalRebatesCollected / Math.max(totalRebatesEarned, 1) >= 0.8
                ? "positive"
                : "negative"
          }
        />
        <HeroStat
          label="Pending Alerts"
          value={formatCount(pendingAlerts)}
          sublabel={pendingAlerts === 0 ? "All clear" : "Review in Alerts tab"}
          tone={pendingAlerts === 0 ? "positive" : "negative"}
        />
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
