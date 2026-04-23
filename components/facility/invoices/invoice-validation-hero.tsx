"use client"

import { FileCheck2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"

/**
 * Hero banner for the Invoice Validation page. Mirrors `AnalysisHero` /
 * `RebateOptimizerHero`:
 *
 *   1. Eyebrow + headline + status pill (top row)
 *   2. Four big-number KPIs separated by `border-y py-6`
 *
 * Replaces the four `border-l-4 border-l-<color>` summary cards with a
 * single elevated plane.
 */
export interface InvoiceValidationHeroStats {
  totalInvoices: number
  awaitingReview: number
  flaggedVariance: number
  recoveredYTD: number
  variancePercent: number
}

export interface InvoiceValidationHeroProps {
  stats: InvoiceValidationHeroStats
  loading?: boolean
}

export function InvoiceValidationHero({
  stats,
  loading = false,
}: InvoiceValidationHeroProps) {
  const {
    totalInvoices,
    awaitingReview,
    flaggedVariance,
    recoveredYTD,
    variancePercent,
  } = stats

  const statusLabel =
    awaitingReview > 0
      ? `${awaitingReview} awaiting review`
      : totalInvoices > 0
        ? "All caught up"
        : "No invoices"
  const statusTone =
    awaitingReview > 0
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
      : totalInvoices > 0
        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
        : "bg-muted text-muted-foreground"

  const headline =
    flaggedVariance > 0
      ? `${formatCurrency(flaggedVariance)} in pricing variance flagged across ${totalInvoices} invoice${totalInvoices === 1 ? "" : "s"}.`
      : totalInvoices > 0
        ? `Tracking ${totalInvoices} invoice${totalInvoices === 1 ? "" : "s"} against contract pricing.`
        : "No invoices imported yet."

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <FileCheck2 className="h-3.5 w-3.5" />
            Invoice Validation
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

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Total Invoices"
          value={loading ? null : totalInvoices.toString()}
          sublabel="under validation"
        />
        <HeroStat
          label="Awaiting Review"
          value={loading ? null : awaitingReview.toString()}
          sublabel={
            awaitingReview > 0
              ? "with pricing discrepancies"
              : "nothing pending"
          }
          tone={awaitingReview > 0 ? "negative" : "muted"}
        />
        <HeroStat
          label="Flagged Variance"
          value={loading ? null : formatCurrency(flaggedVariance)}
          sublabel={
            flaggedVariance > 0
              ? `avg ${variancePercent.toFixed(1)}% over contract`
              : "within contract pricing"
          }
          tone={flaggedVariance > 0 ? "negative" : "muted"}
        />
        <HeroStat
          label="Recovered YTD"
          value={loading ? null : formatCurrency(recoveredYTD)}
          sublabel="from resolved cases"
          tone={recoveredYTD > 0 ? "positive" : "muted"}
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
        <Skeleton className="h-9 w-28 sm:h-10" />
      ) : (
        <p className="text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
          {value}
        </p>
      )}
      <p className={`text-xs ${sublabelClass}`}>{sublabel}</p>
    </div>
  )
}
