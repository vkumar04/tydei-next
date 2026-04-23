"use client"

/**
 * Hero banner for the vendor Reports hub.
 *
 * Mirrors the "hero + tabs" pattern used by facility Analysis,
 * Rebate Optimizer, Contracts, and facility Reports:
 *
 *   1. Eyebrow + headline
 *   2. Status pill (Automation enabled / No schedules)
 *   3. Four hero stats separated by `border-y py-6`:
 *        Reports Generated (MTD) · Scheduled · Last Sent · Facilities Reached
 *
 * Reference: components/facility/reports/reports-hero.tsx,
 * components/facility/analysis/analysis-hero.tsx.
 */

import { FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export interface VendorReportsHeroProps {
  generatedThisMonth: number
  scheduledCount: number
  lastSentAt: string | null
  facilitiesReached: number
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never"
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  if (Number.isNaN(then)) return "Never"
  if (diffMs < 0) return "Just now"
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  const yr = Math.floor(day / 365)
  return `${yr}y ago`
}

export function VendorReportsHero({
  generatedThisMonth,
  scheduledCount,
  lastSentAt,
  facilitiesReached,
}: VendorReportsHeroProps) {
  const statusLabel =
    scheduledCount > 0
      ? `${scheduledCount} scheduled`
      : "Manual delivery"
  const statusTone =
    scheduledCount > 0
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
      : "bg-muted text-muted-foreground"

  const headline =
    generatedThisMonth > 0
      ? `${formatCount(generatedThisMonth)} report${generatedThisMonth === 1 ? "" : "s"} generated this month across ${formatCount(facilitiesReached)} facilit${facilitiesReached === 1 ? "y" : "ies"}.`
      : "No reports generated yet this month — pick a type below to start."

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Reports
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
          label="Generated (MTD)"
          value={formatCount(generatedThisMonth)}
          sublabel="month-to-date deliveries"
        />
        <HeroStat
          label="Scheduled"
          value={formatCount(scheduledCount)}
          sublabel={
            scheduledCount > 0 ? "recurring schedules" : "none configured"
          }
          tone={scheduledCount > 0 ? "positive" : "muted"}
        />
        <HeroStat
          label="Last Sent"
          value={relativeTime(lastSentAt)}
          sublabel={lastSentAt ? "most recent delivery" : "no reports yet"}
          tone={lastSentAt ? undefined : "muted"}
        />
        <HeroStat
          label="Facilities Reached"
          value={formatCount(facilitiesReached)}
          sublabel="distinct recipients"
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
