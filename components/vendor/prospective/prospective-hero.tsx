"use client"

import { ArrowRight, CheckCircle2, Gauge, Sparkles, Target, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"
import type { VendorProposal } from "@/lib/actions/prospective"

/**
 * Hero banner for the vendor Prospective page. Mirrors `AnalysisHero` /
 * `RebateOptimizerHero`:
 *
 *   1. Label + headline + status badge
 *   2. Three big-number KPIs separated by `border-y py-6`
 *   3. Coaching bullets on the left + best-prospect callout on the right
 *
 * Replaces the four-card `TopMetrics` grid — same numbers, one elevated plane.
 */
export interface ProspectiveHeroProps {
  proposals: VendorProposal[]
  totalProposals: number
  totalProjectedSpend: number
}

export function ProspectiveHero({
  proposals,
  totalProposals,
  totalProjectedSpend,
}: ProspectiveHeroProps) {
  const scored = proposals.filter((p) => p.dealScore)
  const avgScore =
    scored.length > 0
      ? Math.round(
          scored.reduce((s, p) => s + (p.dealScore?.overall ?? 0), 0) / scored.length,
        )
      : null
  const acceptable = proposals.filter(
    (p) =>
      p.dealScore &&
      (p.dealScore.recommendation === "accept" ||
        p.dealScore.recommendation === "strong_accept"),
  ).length

  const submitted = proposals.filter((p) => p.status === "submitted").length
  const accepted = proposals.filter((p) => p.status === "accepted").length

  const bestProspect =
    scored.length > 0
      ? [...scored].sort(
          (a, b) => (b.dealScore?.overall ?? 0) - (a.dealScore?.overall ?? 0),
        )[0]
      : null

  const statusLabel =
    acceptable > 0
      ? `${acceptable} acceptable deal${acceptable === 1 ? "" : "s"}`
      : totalProposals > 0
        ? `${submitted} in flight`
        : "No proposals yet"
  const statusTone =
    acceptable > 0
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
      : totalProposals > 0
        ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100"
        : "bg-muted text-muted-foreground"

  const headline =
    totalProposals > 0
      ? `${formatCurrency(totalProjectedSpend)} projected spend across ${totalProposals} proposal${totalProposals === 1 ? "" : "s"}.`
      : "Model a proposal to a facility to start building pipeline."

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            Prospective Analysis
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {headline}
          </h2>
        </div>
        <Badge variant="secondary" className={`text-sm font-medium ${statusTone}`}>
          {statusLabel}
        </Badge>
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-3">
        <HeroStat
          label="Total Proposals"
          value={totalProposals.toString()}
          sublabel={
            totalProposals === 0
              ? "nothing in pipeline"
              : `${scored.length} scored / ${accepted} accepted`
          }
        />
        <HeroStat
          label="Projected Spend"
          value={formatCurrency(totalProjectedSpend)}
          sublabel="across all proposals"
          tone={totalProjectedSpend > 0 ? "positive" : "muted"}
        />
        <HeroStat
          label="Avg Deal Score"
          value={avgScore === null ? "—" : avgScore.toString()}
          sublabel={
            acceptable > 0
              ? `${acceptable} rated accept or better`
              : scored.length > 0
                ? `${scored.length} scored`
                : "no scored deals yet"
          }
          tone={avgScore !== null && avgScore >= 75 ? "positive" : "muted"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ul className="space-y-2">
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <Target className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              Use <strong>Opportunities</strong> to spot facilities priced
              above benchmark — a natural wedge for a new proposal.
            </span>
          </li>
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <Gauge className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              The <strong>Deal Scorer</strong> grades each proposal on price,
              terms, and fit so you know which to push hardest.
            </span>
          </li>
          <li className="flex items-start gap-2.5 text-sm leading-relaxed">
            <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>
              <strong>Benchmarks</strong> and <strong>Analytics</strong> show
              where your pricing sits vs the market across categories.
            </span>
          </li>
        </ul>

        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5" />
            Top prospect
          </div>
          {bestProspect && bestProspect.dealScore ? (
            <>
              <p className="mt-2 text-sm font-semibold">
                {bestProspect.itemCount} item
                {bestProspect.itemCount === 1 ? "" : "s"} ·{" "}
                {bestProspect.facilityIds.length} facilit
                {bestProspect.facilityIds.length === 1 ? "y" : "ies"}
              </p>
              <p className="text-xs capitalize text-muted-foreground">
                {bestProspect.dealScore.recommendation.replace("_", " ")}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-sm">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="font-semibold tabular-nums">
                  Score {bestProspect.dealScore.overall}
                </span>
                <span className="text-muted-foreground">
                  · {formatCurrency(bestProspect.totalProposedCost)}
                </span>
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No scored proposals yet — build one to get a recommendation.
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
