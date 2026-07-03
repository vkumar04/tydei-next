"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Gauge } from "lucide-react"
import { DealScoreRadar } from "@/components/facility/analysis/deal-score-radar"
import type { DealScore } from "@/lib/actions/prospective"
import {
  recommendationForDealScore,
  type DealScoreBreakdown,
} from "@/lib/prospective-analysis/deal-score"

interface DealScoreViewProps {
  score: DealScore
  /** Optional per-component legend (Wave-3 F weighted blend) — rendered
   *  beneath the radar when the caller has a breakdown. */
  breakdown?: DealScoreBreakdown | null
}

export function DealScoreView({ score, breakdown }: DealScoreViewProps) {
  const tips: Record<string, string> = {
    strong_accept: "This proposal is well-positioned for acceptance.",
    accept: "This proposal has favorable terms overall.",
    negotiate: "Consider adjusting pricing or terms to strengthen the deal.",
    reject: "This proposal may need significant revisions.",
  }

  return (
    <div className="space-y-4">
      <DealScoreRadar score={score} />
      {breakdown && <DealScoreLegend breakdown={breakdown} />}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recommendation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {tips[score.recommendation] ?? tips.negotiate}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Weighted-score legend (Wave-3 F) ──────────────────────────

const REC_LABEL: Record<string, string> = {
  strong_accept: "Strong accept",
  accept: "Accept",
  negotiate: "Negotiate",
  reject: "Reject",
}

function RecommendationBadge({ score }: { score: number }) {
  const rec = recommendationForDealScore(score)
  if (rec === "strong_accept" || rec === "accept") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        {REC_LABEL[rec]}
      </Badge>
    )
  }
  if (rec === "reject") {
    return <Badge variant="destructive">{REC_LABEL[rec]}</Badge>
  }
  return <Badge variant="secondary">{REC_LABEL[rec]}</Badge>
}

/**
 * "What moves this score" — the per-component points/max bars + detail
 * lines from the weighted deal-score blend (`computeDealScore`,
 * lib/prospective-analysis/deal-score.ts), plus an explicit amber flag
 * when the margin component rests on the 55% GM assumption.
 */
export function DealScoreLegend({
  breakdown,
}: {
  breakdown: DealScoreBreakdown
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" />
            Deal score — what moves it
          </CardTitle>
          <div className="flex items-center gap-2">
            <RecommendationBadge score={breakdown.overall} />
            <span className="text-2xl font-bold tabular-nums">
              {breakdown.overall}
              <span className="text-sm font-normal text-muted-foreground">
                /100
              </span>
            </span>
          </div>
        </div>
        <CardDescription>
          Weighted blend: margin vs target, price vs benchmark, rebate
          competitiveness, share-ask realism, and data confidence.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {breakdown.marginAssumed && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/50 p-3 text-sm dark:bg-amber-900/10">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Margin assumed at 55% GM (no internal cost entered) — enter your
              true unit cost for a real margin read.
            </span>
          </div>
        )}
        <div className="space-y-3">
          {breakdown.components.map((c) => {
            const fillPct =
              c.max > 0 ? Math.min(100, Math.max(0, (c.points / c.max) * 100)) : 0
            return (
              <div key={c.key} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{c.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {c.points}/{c.max}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
