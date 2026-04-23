"use client"

import { AlertCircle, ShoppingCart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"

/**
 * Hero banner for the facility Purchase Orders list page. Collapses the
 * four stacked KPI cards from the old layout into one elevated, scannable
 * unit that mirrors the "hero + tabs" pattern used on the contracts and
 * rebate-optimizer pages.
 *
 * Numbers shown:
 *   - Total POs (lifetime count across the facility)
 *   - On-Contract Spend (sum of totalCost where a contract is linked)
 *   - Off-Contract Spend (sum of totalCost where contract is null)
 *   - Pending Approval (count of POs in `pending` status)
 */
export interface POHeroProps {
  totalPOs: number
  onContractSpend: number
  offContractSpend: number
  pendingApproval: number
  totalValue: number
  isLoading?: boolean
}

export function POHero({
  totalPOs,
  onContractSpend,
  offContractSpend,
  pendingApproval,
  totalValue,
  isLoading,
}: POHeroProps) {
  const offContractShare =
    totalValue > 0 ? Math.round((offContractSpend / totalValue) * 100) : 0

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <ShoppingCart className="h-3.5 w-3.5" />
            Purchase Orders
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {isLoading ? (
              <Skeleton className="h-7 w-72" />
            ) : totalPOs === 0 ? (
              <>No purchase orders yet</>
            ) : (
              <>
                {totalPOs} {totalPOs === 1 ? "order" : "orders"}
                {" · "}
                <span className="text-muted-foreground">
                  {formatCurrency(totalValue)} lifetime spend
                </span>
              </>
            )}
          </h2>
        </div>
        {pendingApproval > 0 && (
          <Badge
            variant="secondary"
            className="gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
          >
            <AlertCircle className="h-3.5 w-3.5" />
            {pendingApproval} pending approval
          </Badge>
        )}
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Total POs"
          value={isLoading ? null : String(totalPOs)}
          sublabel="Across all statuses"
        />
        <HeroStat
          label="On-Contract Spend"
          value={isLoading ? null : formatCurrency(onContractSpend)}
          sublabel="Orders tied to a contract"
          tone="positive"
        />
        <HeroStat
          label="Off-Contract Spend"
          value={isLoading ? null : formatCurrency(offContractSpend)}
          sublabel={
            totalValue > 0
              ? `${offContractShare}% of lifetime spend`
              : "No spend yet"
          }
          tone={offContractSpend > 0 ? "negative" : "muted"}
        />
        <HeroStat
          label="Pending Approval"
          value={isLoading ? null : String(pendingApproval)}
          sublabel={
            pendingApproval > 0 ? "Awaiting review" : "Nothing queued"
          }
          tone={pendingApproval > 0 ? "negative" : "muted"}
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
