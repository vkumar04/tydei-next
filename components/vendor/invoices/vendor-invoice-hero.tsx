"use client"

import { FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"

/**
 * Hero banner for the Vendor Invoices page. Mirrors the facility
 * `InvoiceValidationHero` and canonical `AnalysisHero`:
 *
 *   1. Eyebrow + headline + status pill (top row)
 *   2. Four big-number KPIs separated by `border-y py-6`
 *
 * Vendor perspective: invoices sent to facilities. Surfaces
 * total invoiced $, paid $, outstanding $ (drafts + submitted),
 * and a count of disputed invoices awaiting resolution.
 */
export interface VendorInvoiceHeroStats {
  totalCount: number
  totalInvoiced: number
  paidAmount: number
  outstandingAmount: number
  disputedCount: number
}

export interface VendorInvoiceHeroProps {
  stats: VendorInvoiceHeroStats
  loading?: boolean
}

export function VendorInvoiceHero({
  stats,
  loading = false,
}: VendorInvoiceHeroProps) {
  const { totalCount, totalInvoiced, paidAmount, outstandingAmount, disputedCount } = stats

  const statusLabel =
    disputedCount > 0
      ? `${disputedCount} disputed`
      : outstandingAmount > 0
        ? `${formatCurrency(outstandingAmount)} outstanding`
        : totalCount > 0
          ? "All clear"
          : "No invoices"

  const statusTone =
    disputedCount > 0
      ? "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100"
      : outstandingAmount > 0
        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
        : totalCount > 0
          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
          : "bg-muted text-muted-foreground"

  const headline =
    totalCount > 0
      ? `${formatCurrency(totalInvoiced)} invoiced across ${totalCount} invoice${totalCount === 1 ? "" : "s"}.`
      : "No invoices submitted yet."

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Vendor Invoices
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {headline}
          </h2>
        </div>
        <Badge variant="secondary" className={`text-sm font-medium ${statusTone}`}>
          {statusLabel}
        </Badge>
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Total Invoiced"
          value={loading ? null : formatCurrency(totalInvoiced)}
          sublabel={`${totalCount} invoice${totalCount === 1 ? "" : "s"}`}
        />
        <HeroStat
          label="Paid"
          value={loading ? null : formatCurrency(paidAmount)}
          sublabel="received to date"
          tone={paidAmount > 0 ? "positive" : "muted"}
        />
        <HeroStat
          label="Outstanding"
          value={loading ? null : formatCurrency(outstandingAmount)}
          sublabel={outstandingAmount > 0 ? "awaiting payment" : "nothing pending"}
          tone={outstandingAmount > 0 ? "negative" : "muted"}
        />
        <HeroStat
          label="Disputed"
          value={loading ? null : disputedCount.toString()}
          sublabel={disputedCount > 0 ? "need resolution" : "none open"}
          tone={disputedCount > 0 ? "negative" : "muted"}
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
