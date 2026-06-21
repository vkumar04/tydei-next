"use client"

/**
 * Charles AI Prospective Impact Engine — presentational layer.
 *
 * Six PURE cards that render already-computed engine results. No state, no
 * fetching, no math: every value comes in as a prop from the engine helpers in
 * `lib/financial-analysis/*`. Keep these dumb so the engine stays the single
 * source of truth.
 */

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Sparkles, TrendingUp, Target, Clock, ShieldCheck } from "lucide-react"

import { usdCompact, usdDelta } from "@/components/facility/analysis/dashboard/format"
import { formatCurrency, formatPercent } from "@/lib/formatting"

import type { FacilityOpportunityScore } from "@/lib/financial-analysis/facility-opportunity-score"
import type { EbitdaEvWaterfall } from "@/lib/financial-analysis/ebitda-ev-waterfall"
import type { ConversionTargetsResult } from "@/lib/financial-analysis/conversion-targets"
import type { PaybackAnalysisResult } from "@/lib/financial-analysis/payback-analysis"
import type { ManagedCarePrediction } from "@/lib/financial-analysis/managed-care-predictor"

const SCENARIO_LABELS: Record<string, string> = {
  conservative: "Conservative",
  expected: "Expected",
  aggressive: "Aggressive",
}

// ---------------------------------------------------------------------------
// 1. Contract Opportunity Score
// ---------------------------------------------------------------------------

export function OpportunityScoreCard({
  score,
}: {
  score: FacilityOpportunityScore
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Contract Opportunity Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-end gap-3">
          <span className="text-5xl font-bold tabular-nums leading-none">
            {score.overall}
          </span>
          <span className="pb-1 text-lg font-medium text-muted-foreground">
            / 100
          </span>
          <Badge variant="secondary" className="mb-1 ml-auto">
            Top {score.topPercentile}%
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">{score.headline}</p>

        <ul className="space-y-3">
          {score.components.map((c) => (
            <li key={c.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  {c.label}
                  <Badge variant="outline" className="text-[10px]">
                    {c.weight}%
                  </Badge>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  +{c.weightedContribution.toFixed(1)} pts
                </span>
              </div>
              <Progress value={c.score} className="h-2" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 2. EBITDA & EV Waterfall
// ---------------------------------------------------------------------------

export function EbitdaEvWaterfallCard({
  waterfall,
}: {
  waterfall: EbitdaEvWaterfall
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">EBITDA &amp; EV Waterfall</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y">
          {waterfall.steps.map((step) => {
            const isEmphasis = step.kind === "base" || step.kind === "total"
            return (
              <li
                key={step.key}
                className="flex items-center justify-between gap-2 py-2 text-sm"
              >
                <span className={isEmphasis ? "font-semibold" : ""}>
                  {step.label}
                </span>
                <span
                  className={
                    "tabular-nums " +
                    (step.kind === "delta"
                      ? "text-emerald-600"
                      : isEmphasis
                        ? "font-semibold"
                        : "")
                  }
                >
                  {step.kind === "delta"
                    ? usdDelta(step.value)
                    : usdCompact(step.value)}
                </span>
              </li>
            )
          })}
        </ul>

        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {usdCompact(waterfall.ev.currentEv)}
            </span>
            <span className="text-muted-foreground">&rarr;</span>
            <span className="font-semibold">
              {usdCompact(waterfall.ev.futureEv)}
            </span>
          </div>
          <Badge variant="secondary">{waterfall.ev.multiple}&times;</Badge>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 3. Enterprise Value Impact Predictor
// ---------------------------------------------------------------------------

export function EvImpactPredictorCard({
  waterfall,
}: {
  waterfall: EbitdaEvWaterfall
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary" />
          Enterprise Value Impact Predictor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Current EV</p>
            <p className="text-xl font-bold tabular-nums">
              {usdCompact(waterfall.ev.currentEv)}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Future EV</p>
            <p className="text-xl font-bold tabular-nums">
              {usdCompact(waterfall.ev.futureEv)}
            </p>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
            <p className="text-xs text-muted-foreground">Incremental EV</p>
            <p className="text-xl font-bold tabular-nums text-emerald-600">
              {usdDelta(waterfall.ev.incrementalEv)}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{waterfall.ev.insight}</p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 4. Recommended Conversion Targets
// ---------------------------------------------------------------------------

export function ConversionTargetsCard({
  result,
}: {
  result: ConversionTargetsResult
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          Recommended Conversion Targets
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.headline ? (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm font-medium">
            {result.headline}
          </div>
        ) : null}

        {result.targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No conversion targets to recommend.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Savings</th>
                  <th className="px-3 py-2 text-right font-medium">
                    % of Benefit
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Behavior Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.targets.map((t) => (
                  <tr key={t.category} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{t.category}</span>
                        {t.aboveBenchmarkAsp ? (
                          <Badge
                            variant="outline"
                            className="border-amber-300 text-[10px] text-amber-700"
                          >
                            Above benchmark ASP
                          </Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {usdCompact(t.savingsOpportunity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatPercent(t.pctOfTotalBenefit * 100)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatPercent(t.volumeSharePct * 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 5. Payback Analysis
// ---------------------------------------------------------------------------

export function PaybackAnalysisCard({
  result,
}: {
  result: PaybackAnalysisResult
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-primary" />
          Payback Analysis
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {formatCurrency(result.investmentCost)} investment
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {result.scenarios.map((s) => (
            <div key={s.scenario} className="rounded-md border p-3 text-center">
              <p className="text-xs text-muted-foreground">
                {SCENARIO_LABELS[s.scenario] ?? s.scenario}
              </p>
              <p className="text-xl font-bold tabular-nums">
                {s.paybackYears === null ? "—" : `${s.paybackYears} yrs`}
              </p>
              <p className="text-xs text-muted-foreground">
                {usdCompact(s.annualBenefit)}/yr
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 6. Managed Care Negotiation Predictor
// ---------------------------------------------------------------------------

export function ManagedCareCard({
  prediction,
}: {
  prediction: ManagedCarePrediction
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Managed Care Negotiation Predictor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-4xl font-bold tabular-nums leading-none">
            {prediction.lowPct}%&ndash;{prediction.highPct}%
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Medicare equivalent
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{prediction.insight}</p>
      </CardContent>
    </Card>
  )
}
