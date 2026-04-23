"use client"

import { AlertTriangle, FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"

/**
 * Hero banner for the vendor contracts-list page. Collapses what were
 * previously four stacked KPI cards into one elevated, scannable unit:
 *
 *   1. Eyebrow + headline sentence (how many contracts, across how many facilities)
 *   2. Warning pill (pending-review count) when non-zero
 *   3. Four hero stats separated by `border-y py-6`:
 *        Total Contracts, Active, Facilities Served, Total Value
 *
 * Mirrors the facility-side `ContractsHero` contract shape. No bottom
 * narrative grid — this is a list page, not an analysis page.
 */
export interface VendorContractsHeroProps {
  totalContracts: number
  activeCount: number
  facilitiesServed: number
  totalValue: number
  pendingReview: number
  expiringSoon: number
  isLoading?: boolean
}

export function VendorContractsHero({
  totalContracts,
  activeCount,
  facilitiesServed,
  totalValue,
  pendingReview,
  expiringSoon,
  isLoading,
}: VendorContractsHeroProps) {
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Vendor contract portfolio
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {isLoading ? (
              <Skeleton className="h-7 w-72" />
            ) : (
              <>
                {totalContracts}{" "}
                {totalContracts === 1 ? "contract" : "contracts"}
                {" · "}
                <span className="text-muted-foreground">
                  {facilitiesServed}{" "}
                  {facilitiesServed === 1 ? "facility" : "facilities"} served
                </span>
              </>
            )}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pendingReview > 0 && (
            <Badge
              variant="secondary"
              className="gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {pendingReview} pending review
            </Badge>
          )}
          {expiringSoon > 0 && (
            <Badge
              variant="secondary"
              className="gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {expiringSoon} expiring in 30 days
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Total Contracts"
          value={isLoading ? null : String(totalContracts)}
          sublabel="All statuses"
        />
        <HeroStat
          label="Active"
          value={isLoading ? null : String(activeCount)}
          sublabel="Currently in effect"
          tone="positive"
        />
        <HeroStat
          label="Facilities Served"
          value={isLoading ? null : String(facilitiesServed)}
          sublabel="Across all contracts"
        />
        <HeroStat
          label="Total Value"
          value={isLoading ? null : formatCurrency(totalValue)}
          sublabel="Lifetime commitment"
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
