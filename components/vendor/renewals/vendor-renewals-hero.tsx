"use client"

/**
 * Hero banner for the vendor Renewals page.
 *
 * Mirrors the facility `RenewalsHero` "hero + tabs" pattern:
 *
 *   1. Eyebrow "Renewals" + dynamic headline + status pill
 *   2. Four hero numbers: 30d / 60d / 90d / At-Risk
 *
 * Vendor-side semantics:
 * - At-Risk = contracts where daysUntilExpiry <= 90 (revenue exposure)
 * - criticalUnstarted = contracts expiring inside the
 *   CRITICAL_UNSTARTED_DAYS window
 */

import { CalendarRange } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export interface VendorRenewalsHeroStats {
  expiring30: number
  expiring60: number
  expiring90: number
  atRisk: number
  totalContracts: number
  criticalUnstarted: number
}

export interface VendorRenewalsHeroProps {
  stats: VendorRenewalsHeroStats
}

export function VendorRenewalsHero({ stats }: VendorRenewalsHeroProps) {
  const {
    expiring30,
    expiring60,
    expiring90,
    atRisk,
    totalContracts,
    criticalUnstarted,
  } = stats

  const totalExpiringSoon = expiring30 + expiring60 + expiring90

  const statusLabel =
    criticalUnstarted > 0
      ? `${criticalUnstarted} need${criticalUnstarted === 1 ? "s" : ""} action`
      : expiring30 > 0
        ? `${expiring30} expiring in 30d`
        : totalContracts > 0
          ? "On track"
          : "No contracts"
  const statusTone =
    criticalUnstarted > 0
      ? "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100"
      : expiring30 > 0
        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
        : totalContracts > 0
          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
          : "bg-muted text-muted-foreground"

  const headline =
    totalContracts === 0
      ? "No contracts on file yet."
      : totalExpiringSoon === 0
        ? `All ${totalContracts} contracts are more than 90 days from expiration.`
        : `${totalExpiringSoon} contract${totalExpiringSoon === 1 ? "" : "s"} expire in the next 90 days.`

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <CalendarRange className="h-3.5 w-3.5" />
            Renewals
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
          label="Expiring in 30 Days"
          value={expiring30.toString()}
          sublabel={
            expiring30 > 0 ? "immediate attention" : "none in window"
          }
          tone={expiring30 > 0 ? "negative" : "muted"}
        />
        <HeroStat
          label="Expiring in 60 Days"
          value={expiring60.toString()}
          sublabel={expiring60 > 0 ? "plan negotiations" : "none in window"}
          tone={expiring60 > 0 ? "positive" : "muted"}
        />
        <HeroStat
          label="Expiring in 90 Days"
          value={expiring90.toString()}
          sublabel={expiring90 > 0 ? "early planning" : "none in window"}
        />
        <HeroStat
          label="At-Risk"
          value={atRisk.toString()}
          sublabel={
            atRisk > 0
              ? "within 90-day window"
              : "all contracts on pace"
          }
          tone={atRisk > 0 ? "negative" : "positive"}
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
