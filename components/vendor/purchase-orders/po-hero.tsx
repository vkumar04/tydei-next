"use client"

import { AlertCircle, ShoppingCart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"

/**
 * Hero banner for the vendor Purchase Orders list page. Mirrors the
 * "hero + tabs" pattern used on the facility POs page and contracts list.
 *
 * Numbers shown:
 *   - Total POs (lifetime count across all facilities the vendor services)
 *   - Total Value (sum of totalCost across all POs)
 *   - Pending Approval (count awaiting facility review)
 *   - Fulfillment Rate (fulfilled ÷ non-cancelled, percentage)
 */
export interface VendorPOHeroProps {
  totalPOs: number
  totalValue: number
  pendingApproval: number
  fulfilled: number
  cancelled: number
  isLoading?: boolean
}

export function VendorPOHero({
  totalPOs,
  totalValue,
  pendingApproval,
  fulfilled,
  cancelled,
  isLoading,
}: VendorPOHeroProps) {
  const eligibleForRate = totalPOs - cancelled
  const fulfillmentRate =
    eligibleForRate > 0 ? Math.round((fulfilled / eligibleForRate) * 100) : 0

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
                  {formatCurrency(totalValue)} lifetime value
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
          sublabel="Across all facilities"
        />
        <HeroStat
          label="Total Value"
          value={isLoading ? null : formatCurrency(totalValue)}
          sublabel="Lifetime order value"
        />
        <HeroStat
          label="Pending Approval"
          value={isLoading ? null : String(pendingApproval)}
          sublabel={
            pendingApproval > 0 ? "Awaiting facility review" : "Nothing queued"
          }
          tone={pendingApproval > 0 ? "negative" : "muted"}
        />
        <HeroStat
          label="Fulfillment Rate"
          value={isLoading ? null : `${fulfillmentRate}%`}
          sublabel={
            eligibleForRate > 0
              ? `${fulfilled} of ${eligibleForRate} fulfilled`
              : "No completed orders"
          }
          tone={fulfillmentRate >= 80 ? "positive" : "muted"}
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
