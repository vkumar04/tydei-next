"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/formatting"
import type { AnalysisVerdict } from "@/lib/financial-analysis/narrative"

/**
 * Top-level KPI panel: NPV (big number), IRR, and narrative verdict.
 * Consumes already-computed values; does no math of its own.
 */
export interface AnalysisResultsPanelProps {
  npv: number
  irr: number | null
  discountRate: number
  verdict: AnalysisVerdict
  headline: string
}

const verdictTone: Record<AnalysisVerdict, string> = {
  strong: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  moderate: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  weak: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  negative: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
}

const verdictLabel: Record<AnalysisVerdict, string> = {
  strong: "Strong ROI",
  moderate: "Moderate ROI",
  weak: "Borderline",
  negative: "Negative ROI",
}

export function AnalysisResultsPanel({
  npv,
  irr,
  discountRate,
  verdict,
  headline,
}: AnalysisResultsPanelProps) {
  const irrPercent = irr === null ? null : irr * 100
  const irrVsHurdle =
    irr === null ? null : (irr - discountRate) * 100 // both decimals → pp

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Result</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{headline}</p>
        </div>
        <Badge className={verdictTone[verdict]} variant="secondary">
          {verdictLabel[verdict]}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            NPV
          </p>
          <p className="text-3xl font-semibold tabular-nums">
            {formatCurrency(npv)}
          </p>
          <p className="text-xs text-muted-foreground">
            at {(discountRate * 100).toFixed(1)}% discount
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            IRR
          </p>
          <p className="text-3xl font-semibold tabular-nums">
            {irrPercent === null ? "—" : `${irrPercent.toFixed(1)}%`}
          </p>
          {irrVsHurdle !== null && (
            <p className="text-xs text-muted-foreground">
              {irrVsHurdle >= 0 ? "+" : ""}
              {irrVsHurdle.toFixed(1)}pp vs hurdle
            </p>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Verdict
          </p>
          <p className="text-3xl font-semibold capitalize">{verdict}</p>
          <p className="text-xs text-muted-foreground">
            Based on NPV vs capital cost
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
