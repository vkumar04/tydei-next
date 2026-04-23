"use client"

/**
 * Hero banner for the facility Reports hub.
 *
 * Mirrors the "hero + tabs" pattern used by Analysis, Rebate Optimizer,
 * Contracts, and Dashboard:
 *
 *   1. Eyebrow + headline ("N contracts · M vendors tracked")
 *   2. Status pill (X active schedules / No automation)
 *   3. Four hero stats separated by `border-y py-6`:
 *        Contracts · Vendors · Active Schedules · Last Sent
 *   4. Utility row with quick-link guidance
 *
 * Reference: components/facility/analysis/analysis-hero.tsx,
 * components/facility/rebate-optimizer/optimizer-hero.tsx.
 */

import {
  AlertTriangle,
  ArrowRight,
  Clock,
  FileText,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"

export interface ReportsHeroProps {
  contractCount: number
  vendorCount: number
  activeSchedules: number
  totalSchedules: number
  lastSentAt: string | null
  priceDiscrepancyHref: string
  onOpenScheduledReports: () => void
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never"
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
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

export function ReportsHero({
  contractCount,
  vendorCount,
  activeSchedules,
  totalSchedules,
  lastSentAt,
  priceDiscrepancyHref,
  onOpenScheduledReports,
}: ReportsHeroProps) {
  const statusLabel =
    activeSchedules > 0
      ? `${activeSchedules} active schedule${activeSchedules === 1 ? "" : "s"}`
      : totalSchedules > 0
        ? "Schedules paused"
        : "No automation"
  const statusTone =
    activeSchedules > 0
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
      : totalSchedules > 0
        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
        : "bg-muted text-muted-foreground"

  const headline =
    contractCount > 0
      ? `Tracking ${formatCount(contractCount)} contract${contractCount === 1 ? "" : "s"} across ${formatCount(vendorCount)} vendor${vendorCount === 1 ? "" : "s"}.`
      : "No contracts tracked yet — add a contract to start reporting."

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
          label="Contracts"
          value={formatCount(contractCount)}
          sublabel="multi-contract reporting"
        />
        <HeroStat
          label="Vendors"
          value={formatCount(vendorCount)}
          sublabel={`across ${formatCount(contractCount)} contract${contractCount === 1 ? "" : "s"}`}
        />
        <HeroStat
          label="Active Schedules"
          value={formatCount(activeSchedules)}
          sublabel={
            totalSchedules > 0
              ? `of ${formatCount(totalSchedules)} total`
              : "set up recurring delivery"
          }
          tone={activeSchedules > 0 ? "positive" : "muted"}
        />
        <HeroStat
          label="Last Sent"
          value={relativeTime(lastSentAt)}
          sublabel={lastSentAt ? "most recent delivery" : "no scheduled runs yet"}
          tone={lastSentAt ? undefined : "muted"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ul className="space-y-2">
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              Use the <strong>Overview</strong> tab for multi-contract
              spend &amp; rebate trends, or switch to a contract-type tab
              (Usage, Capital, Service, Tie-In, Grouped, Pricing) to drill
              in.
            </span>
          </li>
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              Selecting a single contract in the filter bar auto-routes
              to its matching tab and shows the <strong>Calculations</strong>{" "}
              drill-down.
            </span>
          </li>
        </ul>

        <div className="space-y-3">
          <a
            href={priceDiscrepancyHref}
            className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/60 p-4 text-left transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-red-950/30 dark:hover:bg-red-950/50"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
            <div className="flex-1 space-y-0.5">
              <p className="text-sm font-semibold">Price Discrepancy</p>
              <p className="text-xs text-muted-foreground">
                Drill into pricing variances between contracts and actual
                purchases
              </p>
            </div>
            <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
          </a>
          <button
            type="button"
            onClick={onOpenScheduledReports}
            className="flex w-full items-start gap-3 rounded-lg border bg-muted/40 p-4 text-left transition-colors hover:bg-muted/70"
          >
            <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1 space-y-0.5">
              <p className="text-sm font-semibold">Scheduled Reports</p>
              <p className="text-xs text-muted-foreground">
                Manage recurring report schedules and recipients
              </p>
            </div>
            <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </button>
        </div>
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
