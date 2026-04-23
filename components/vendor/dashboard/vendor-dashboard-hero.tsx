"use client"

/**
 * Vendor dashboard — hero banner.
 *
 * Mirrors the facility dashboard-hero pattern: eyebrow, headline sentence,
 * optional pill, and four hero stats separated by `border-y py-6`. The
 * vendor-side KPIs condense the previous 4-card `VendorStats` grid plus
 * the "Vendor View Active" info banner into one elevated top-of-page unit.
 */

import { Building2, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"

export interface VendorDashboardHeroProps {
  vendorName: string
  activeContracts: number
  totalContracts: number
  totalSpend: number
  totalRebates: number
  activeFacilities: number
  marketSharePercent: number
  isLoading?: boolean
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

export function VendorDashboardHero({
  vendorName,
  activeContracts,
  totalContracts,
  totalSpend,
  totalRebates,
  activeFacilities,
  marketSharePercent,
  isLoading,
}: VendorDashboardHeroProps) {
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            Vendor overview
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {isLoading ? (
              <Skeleton className="h-7 w-80" />
            ) : (
              <>
                {vendorName}
                {" · "}
                <span className="text-muted-foreground">
                  {formatCount(activeContracts)} active{" "}
                  {activeContracts === 1 ? "contract" : "contracts"} across{" "}
                  {formatCount(activeFacilities)}{" "}
                  {activeFacilities === 1 ? "facility" : "facilities"}
                </span>
              </>
            )}
          </h2>
        </div>
        <Badge
          variant="secondary"
          className="gap-1.5 bg-primary/10 text-primary dark:bg-primary/20"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Aggregated view
        </Badge>
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Active Contracts"
          value={isLoading ? null : formatCount(activeContracts)}
          sublabel={`of ${formatCount(totalContracts)} total`}
          tone="positive"
        />
        <HeroStat
          label="Active Facilities"
          value={isLoading ? null : formatCount(activeFacilities)}
          sublabel="With active contracts"
        />
        <HeroStat
          label="Total Spend on Contract"
          value={isLoading ? null : formatCurrency(totalSpend)}
          sublabel={`${marketSharePercent.toFixed(1)}% market share`}
          tone={marketSharePercent >= 10 ? "positive" : "muted"}
        />
        <HeroStat
          label="Rebates Paid"
          value={isLoading ? null : formatCurrency(totalRebates)}
          sublabel="Lifetime across facilities"
          tone="positive"
        />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        You are viewing aggregated data. Individual facility pricing and
        competitor details are not visible.
      </p>
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
