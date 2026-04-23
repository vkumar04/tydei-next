"use client"

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  TrendingUp,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"
import type {
  AnalysisNarrative,
  AnalysisVerdict,
} from "@/lib/financial-analysis/narrative"

/**
 * Hero banner for the financial-analysis page. Merges what were previously
 * three separate cards (Results panel, Narrative summary, implicit verdict)
 * into one dense, scannable top-of-page unit:
 *
 *   1. Verdict pill + headline (what's the answer?)
 *   2. Three hero numbers: NPV, IRR, IRR-vs-hurdle (why's it the answer?)
 *   3. Narrative bullets + risks (how did we get there?)
 *   4. Recommendation line (what do we do about it?)
 *
 * No Card wrapper — this is a top-level hero. The parent supplies the
 * shadow/border treatment so the hero renders as an "elevated plane"
 * rather than another box in a list of boxes.
 */
export interface AnalysisHeroProps {
  npv: number
  irr: number | null
  discountRate: number
  verdict: AnalysisVerdict
  narrative: AnalysisNarrative
}

const verdictLabel: Record<AnalysisVerdict, string> = {
  strong: "Strong ROI",
  moderate: "Moderate ROI",
  weak: "Borderline",
  negative: "Negative ROI",
}

const verdictTone: Record<AnalysisVerdict, string> = {
  strong:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  moderate:
    "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  weak:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  negative:
    "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
}

export function AnalysisHero({
  npv,
  irr,
  discountRate,
  verdict,
  narrative,
}: AnalysisHeroProps) {
  const irrPercent = irr === null ? null : irr * 100
  const irrVsHurdle =
    irr === null ? null : (irr - discountRate) * 100

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            Capital ROI
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {narrative.headline}
          </h2>
        </div>
        <Badge
          variant="secondary"
          className={`text-sm font-medium ${verdictTone[verdict]}`}
        >
          {verdictLabel[verdict]}
        </Badge>
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-3">
        <HeroStat
          label="Net Present Value"
          value={formatCurrency(npv)}
          sublabel={`at ${(discountRate * 100).toFixed(1)}% discount`}
        />
        <HeroStat
          label="Internal Rate of Return"
          value={irrPercent === null ? "—" : `${irrPercent.toFixed(1)}%`}
          sublabel={
            irrVsHurdle === null
              ? "unable to solve"
              : `${irrVsHurdle >= 0 ? "+" : ""}${irrVsHurdle.toFixed(1)}pp vs hurdle`
          }
          tone={irrVsHurdle === null ? "muted" : irrVsHurdle >= 0 ? "positive" : "negative"}
        />
        <HeroStat
          label="Verdict"
          value={verdictLabel[verdict]}
          sublabel="Based on NPV vs capital cost"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {narrative.bullets.length > 0 && (
            <ul className="space-y-2">
              {narrative.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {narrative.risks.length > 0 && (
            <ul className="space-y-2">
              {narrative.risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5" />
            Recommendation
          </div>
          <p className="mt-2 text-sm leading-relaxed">{narrative.cta}</p>
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
