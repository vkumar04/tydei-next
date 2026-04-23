"use client"

import { Database } from "lucide-react"
import { format } from "date-fns"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"

/**
 * Hero banner for the facility COG Data page. Promotes the core purchase-history
 * story (lifetime spend and match coverage) into one elevated, scannable unit
 * instead of the previous 5-card grid.
 *
 *   1. Eyebrow + headline sentence ("$X across N records, dated A–B")
 *   2. Four hero stats separated by `border-y py-6`:
 *        Total Spend, On-Contract %, Total Records, Data Date Range
 *
 * Matched/unmatched drilldowns live in CogEnrichmentStatsPanel below; the
 * hero intentionally surfaces only the top-line KPIs.
 */
export interface CogHeroProps {
  totalSpend: number
  totalItems: number
  onContractCount: number
  offContractCount: number
  minPODate: Date | string | null
  maxPODate: Date | string | null
  isLoading?: boolean
}

export function CogHero({
  totalSpend,
  totalItems,
  onContractCount,
  offContractCount,
  minPODate,
  maxPODate,
  isLoading,
}: CogHeroProps) {
  const onContractPct =
    totalItems > 0 ? Math.round((onContractCount / totalItems) * 100) : 0
  const dateRangeLabel =
    minPODate && maxPODate
      ? `${format(new Date(minPODate), "MMM d, yyyy")} – ${format(
          new Date(maxPODate),
          "MMM d, yyyy",
        )}`
      : "No data loaded"
  const dateRangeShort =
    minPODate && maxPODate
      ? `${format(new Date(minPODate), "MMM yyyy")} – ${format(
          new Date(maxPODate),
          "MMM yyyy",
        )}`
      : "—"
  const headline =
    totalItems > 0
      ? `${formatCurrency(totalSpend)} across ${totalItems.toLocaleString()} ${
          totalItems === 1 ? "record" : "records"
        }`
      : "No purchase history loaded yet"

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            COG Data
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {isLoading ? (
              <Skeleton className="h-7 w-72" />
            ) : (
              <>
                {headline}
                {minPODate && maxPODate ? (
                  <>
                    {" · "}
                    <span className="text-muted-foreground">
                      {dateRangeLabel}
                    </span>
                  </>
                ) : null}
              </>
            )}
          </h2>
        </div>
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Total Spend"
          value={isLoading ? null : formatCurrency(totalSpend)}
          sublabel="Lifetime cost of goods"
        />
        <HeroStat
          label="On-Contract"
          value={isLoading ? null : `${onContractPct}%`}
          sublabel={
            totalItems > 0
              ? `${onContractCount.toLocaleString()} of ${totalItems.toLocaleString()} records`
              : "No records yet"
          }
          tone={onContractPct > 0 ? "positive" : "muted"}
        />
        <HeroStat
          label="Total Records"
          value={isLoading ? null : totalItems.toLocaleString()}
          sublabel={
            offContractCount > 0
              ? `${offContractCount.toLocaleString()} off-contract`
              : "All matched or pending"
          }
        />
        <HeroStat
          label="Data Range"
          value={isLoading ? null : dateRangeShort}
          sublabel={
            minPODate && maxPODate ? dateRangeLabel : "Import data to begin"
          }
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
