"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DealScoreRadar } from "@/components/facility/analysis/deal-score-radar"
import type { DealScore } from "@/lib/actions/prospective"

interface DealScoreViewProps {
  score: DealScore
}

export function DealScoreView({ score }: DealScoreViewProps) {
  const tips: Record<string, string> = {
    strong_accept: "This proposal is well-positioned for acceptance.",
    accept: "This proposal has favorable terms overall.",
    negotiate: "Consider adjusting pricing or terms to strengthen the deal.",
    reject: "This proposal may need significant revisions.",
  }

  return (
    <div className="space-y-4">
      <DealScoreRadar score={score} />
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
