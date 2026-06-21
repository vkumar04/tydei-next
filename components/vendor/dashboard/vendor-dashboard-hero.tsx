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
import { HeroStat } from "@/components/shared/stats/hero-stat"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatNumber } from "@/lib/formatting"

export interface VendorDashboardHeroProps {
  vendorName: string
  activeContracts: number
  totalContracts: number
  /** Trailing-12mo sales — the primary figure (2026-06-09 audit: align
   *  with the facility side's trailing-12mo "Current Spend" window). */
  salesTrailing12Mo: number
  /** Lifetime sales — rendered as the sublabel so no info is lost. */
  totalSpend: number
  totalRebates: number
  activeFacilities: number
  marketSharePercent: number
  isLoading?: boolean
}

export function VendorDashboardHero({
  vendorName,
  activeContracts,
  totalContracts,
  salesTrailing12Mo,
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
                  {formatNumber(activeContracts)} active{" "}
                  {activeContracts === 1 ? "contract" : "contracts"} across{" "}
                  {formatNumber(activeFacilities)}{" "}
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
          value={isLoading ? null : formatNumber(activeContracts)}
          sublabel={`of ${formatNumber(totalContracts)} total`}
          tone="positive"
          skeleton={<Skeleton className="h-9 w-28" />}
        />
        <HeroStat
          label="Active Facilities"
          value={isLoading ? null : formatNumber(activeFacilities)}
          sublabel="With active contracts"
          skeleton={<Skeleton className="h-9 w-28" />}
        />
        {/* 2026-06-09 audit: primary sales figure is now trailing-12mo
            (same window as the facility side's "Current Spend"); the
            lifetime figure moves to the sublabel so no info is lost. */}
        <HeroStat
          label="Sales (Trailing 12 Mo)"
          value={isLoading ? null : formatCurrency(salesTrailing12Mo)}
          sublabel={`lifetime ${formatCurrency(totalSpend)} · ${marketSharePercent.toFixed(1)}% market share`}
          tone={marketSharePercent >= 10 ? "positive" : "muted"}
          skeleton={<Skeleton className="h-9 w-28" />}
        />
        <HeroStat
          label="Rebates Paid"
          value={isLoading ? null : formatCurrency(totalRebates)}
          sublabel="Lifetime across facilities"
          tone="positive"
          skeleton={<Skeleton className="h-9 w-28" />}
        />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        You are viewing aggregated data. Individual facility pricing and
        competitor details are not visible.
      </p>
    </section>
  )
}
