"use client"

import { ArrowRight, PieChart as PieChartIcon, Trophy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"
import type { CategoryRow, MarketShareStats } from "./sections/types"

/**
 * Hero banner for the vendor market-share page. Mirrors `AnalysisHero` and
 * `RebateOptimizerHero`:
 *
 *   1. Label + headline + status badge (top row)
 *   2. Four big-number KPIs separated by `border-y py-6`
 *   3. Bullet takeaways on the left, "largest competitor gap" callout
 *      on the right
 *
 * Replaces the three `MetricCard` tiles from the old layout — same
 * numbers, one elevated plane instead of a card farm.
 */

export interface MarketShareHeroProps {
  stats: MarketShareStats
  categoryRows: CategoryRow[]
}

interface CompetitorGap {
  category: string
  gap: number
  sharePct: number
}

export function MarketShareHero({ stats, categoryRows }: MarketShareHeroProps) {
  // Categories where this vendor leads (share >= 50%).
  const leaderCount = categoryRows.filter((r) => r.sharePct >= 50).length

  // YoY growth proxy: not available from the current query, so we render
  // `—` rather than fabricate a number.
  const yoyLabel = "—"
  const yoySub = "not yet tracked"

  // "Top competitor" = the category with the largest competitor spend
  // (totalMarket - vendorShare). That's the category where the biggest
  // rival book of business lives.
  const topCompetitor: CompetitorGap | null = categoryRows.length
    ? categoryRows.reduce<CompetitorGap | null>((best, r) => {
        const gap = r.totalMarket - r.yourSpend
        if (!best || gap > best.gap) {
          return { category: r.category, gap, sharePct: r.sharePct }
        }
        return best
      }, null)
    : null

  const statusLabel =
    stats.overallSharePct >= 50
      ? "Market leader"
      : stats.overallSharePct >= 25
        ? "Strong position"
        : categoryRows.length > 0
          ? "Growth runway"
          : "No data"
  const statusTone =
    stats.overallSharePct >= 50
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
      : stats.overallSharePct >= 25
        ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100"
        : categoryRows.length > 0
          ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
          : "bg-muted text-muted-foreground"

  const headline =
    stats.totalMarketSpend > 0
      ? `${formatCurrency(stats.totalVendorSpend)} of ${formatCurrency(
          stats.totalMarketSpend,
        )} in tracked spend across ${stats.totalCategories} categor${
          stats.totalCategories === 1 ? "y" : "ies"
        }.`
      : "No market-share data available yet."

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <PieChartIcon className="h-3.5 w-3.5" />
            Market Share
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
          label="Overall Share"
          value={`${stats.overallSharePct.toFixed(1)}%`}
          sublabel={`of ${formatCurrency(stats.totalMarketSpend)} tracked`}
          tone={stats.overallSharePct >= 25 ? "positive" : "muted"}
        />
        <HeroStat
          label="Category Leader"
          value={leaderCount.toString()}
          sublabel={
            leaderCount === 0
              ? "no categories above 50%"
              : `categor${leaderCount === 1 ? "y" : "ies"} above 50% share`
          }
          tone={leaderCount > 0 ? "positive" : "muted"}
        />
        <HeroStat
          label="YoY Growth"
          value={yoyLabel}
          sublabel={yoySub}
          tone="muted"
        />
        <HeroStat
          label="Top Competitor Category"
          value={topCompetitor ? `${(100 - topCompetitor.sharePct).toFixed(0)}%` : "—"}
          sublabel={
            topCompetitor
              ? `${topCompetitor.category} — ${formatCurrency(topCompetitor.gap)} open`
              : "no competitor signal"
          }
          tone={topCompetitor ? "negative" : "muted"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ul className="space-y-2">
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <Trophy className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              The <strong>By Category</strong> tab shows per-category share,
              consolidates lookalike category names, and highlights low-share
              growth targets.
            </span>
          </li>
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <PieChartIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              The <strong>By Facility</strong> tab ranks facilities by vendor
              spend concentration; the <strong>Competitors</strong> tab surfaces
              categories with the widest competitor gap.
            </span>
          </li>
        </ul>

        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5" />
            Widest competitor gap
          </div>
          {topCompetitor ? (
            <>
              <p
                className="mt-2 truncate text-sm font-semibold"
                title={topCompetitor.category}
              >
                {topCompetitor.category}
              </p>
              <p className="text-xs text-muted-foreground">
                You hold {topCompetitor.sharePct.toFixed(1)}% of this category
              </p>
              <p className="mt-2 text-sm">
                <span className="font-semibold tabular-nums">
                  {formatCurrency(topCompetitor.gap)}
                </span>{" "}
                <span className="text-muted-foreground">
                  addressable by competitors today
                </span>
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No competitor signal yet — load more COG data to surface gaps.
            </p>
          )}
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
