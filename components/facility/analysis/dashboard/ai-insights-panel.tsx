"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sparkles, Loader2, AlertTriangle } from "lucide-react"
import type { FacilityAnalysisInsights } from "@/lib/ai/analysis-insight-schemas"

interface AiInsightsPanelProps {
  insights: FacilityAnalysisInsights | undefined
  isPending: boolean
  error: Error | null
  onGenerate: () => void
}

/** On-demand AI narrative layer for the facility dashboard. The deterministic
 *  cards below own the numbers; this panel explains them and recommends action. */
export function AiInsightsPanel({
  insights,
  isPending,
  error,
  onGenerate,
}: AiInsightsPanelProps) {
  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Insights
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Claude reads your real spend and the deterministic model to explain
            the opportunity and recommend where to focus.
          </p>
        </div>
        <Button onClick={onGenerate} disabled={isPending} className="shrink-0">
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : insights ? (
            "Regenerate AI insights"
          ) : (
            "Generate AI insights"
          )}
        </Button>
      </CardHeader>

      {error && (
        <CardContent>
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error.message}</span>
          </div>
        </CardContent>
      )}

      {insights && !error && (
        <CardContent className="space-y-5">
          <Section title="Executive summary">{insights.executiveSummary}</Section>

          <Section title="Contract Opportunity Score">
            {insights.opportunityScoreRead}
          </Section>

          <Section title="Recommended Conversion Targets">
            {insights.conversionTargets.narrative}
            {insights.conversionTargets.recommendations.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {insights.conversionTargets.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Managed Care Negotiation Predictor">
            <div className="mb-1 text-lg font-semibold tabular-nums">
              {insights.managedCare.recommendedReimbursementLowPct}%–
              {insights.managedCare.recommendedReimbursementHighPct}%
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Medicare equivalent
              </span>
            </div>
            {insights.managedCare.narrative}
          </Section>

          <Section title="Enterprise Value Impact">
            {insights.enterpriseValueNarrative}
          </Section>
        </CardContent>
      )}
    </Card>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="mt-1 text-sm text-muted-foreground">{children}</div>
    </div>
  )
}
