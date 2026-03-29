"use client"

import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DealScoreRadar } from "@/components/facility/analysis/deal-score-radar"
import type { DealScoreResult } from "@/lib/ai/schemas"

interface AIScorePageProps {
  contractId: string
  contractData: Record<string, unknown>
  cogData: Record<string, unknown>
}

export function AIScorePage({ contractId, contractData, cogData }: AIScorePageProps) {
  const { data: score, isLoading } = useQuery<DealScoreResult>({
    queryKey: ["ai", "score", contractId],
    queryFn: async () => {
      const res = await fetch("/api/ai/score-deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractData, cogData }),
      })
      if (!res.ok) throw new Error("Scoring failed")
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-8 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">
          Analyzing deal...
        </span>
      </div>
    )
  }

  if (!score) return null

  const radarScore = {
    overall: score.overallScore,
    financialValue: score.financialValue,
    rebateEfficiency: score.rebateEfficiency,
    pricingCompetitiveness: score.pricingCompetitiveness,
    marketShareAlignment: score.marketShareAlignment,
    complianceLikelihood: score.complianceLikelihood,
    recommendation: mapRecommendation(score.overallScore),
  }

  return (
    <div className="space-y-6">
      <DealScoreRadar score={radarScore} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">AI Recommendation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{score.recommendation}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Negotiation Advice</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {score.negotiationAdvice.map((advice, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Badge variant="outline" className="mt-0.5 shrink-0">
                  {i + 1}
                </Badge>
                {advice}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function mapRecommendation(
  overall: number
): "strong_accept" | "accept" | "negotiate" | "reject" {
  if (overall >= 80) return "strong_accept"
  if (overall >= 65) return "accept"
  if (overall >= 40) return "negotiate"
  return "reject"
}
