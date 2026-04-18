"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react"
import type { AnalysisNarrative } from "@/lib/financial-analysis/narrative"

/**
 * Renders the deterministic narrative built by
 * `buildFinancialAnalysisNarrative`. Displays headline, supporting
 * bullets, surfaced risks, and the call-to-action recommendation.
 */
export interface AnalysisNarrativeCardProps {
  narrative: AnalysisNarrative
}

export function AnalysisNarrativeCard({
  narrative,
}: AnalysisNarrativeCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Narrative summary</CardTitle>
        <CardDescription>{narrative.headline}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Highlights
          </h3>
          <ul className="space-y-1.5">
            {narrative.bullets.map((bullet, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>

        {narrative.risks.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Risks
            </h3>
            <ul className="space-y-1.5">
              {narrative.risks.map((risk, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
          <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recommendation
            </p>
            <p className="text-sm">{narrative.cta}</p>
          </div>
        </div>

        <Button variant="outline" size="sm" disabled>
          Generate AI summary (coming soon)
        </Button>
      </CardContent>
    </Card>
  )
}
