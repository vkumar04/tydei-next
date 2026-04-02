"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip as RechartsTooltip,
} from "recharts"
import { chartTooltipStyle } from "@/lib/chart-config"
import { Target, BarChart3 } from "lucide-react"
import type { DealScore } from "@/lib/actions/prospective"

interface RadarDataPoint {
  dimension: string
  value: number
  fullMark: number
}

export interface DealScorePanelProps {
  dealScore: DealScore
  radarData: RadarDataPoint[]
  recommendationLabel: string | null
}

export function DealScorePanel({
  dealScore,
  radarData,
  recommendationLabel,
}: DealScorePanelProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Deal Score Radar Chart - 6 dimensions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Deal Score
          </CardTitle>
          <CardDescription>
            Overall: {dealScore.overall}/100 —{" "}
            {recommendationLabel ?? "Needs Negotiation"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid className="stroke-muted" />
                <PolarAngleAxis
                  dataKey="dimension"
                  tick={{ fontSize: 10 }}
                  className="fill-muted-foreground"
                />
                <PolarRadiusAxis
                  angle={30}
                  domain={[0, 100]}
                  tick={{ fontSize: 10 }}
                />
                <Radar
                  name="Score"
                  dataKey="value"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
                <RechartsTooltip contentStyle={chartTooltipStyle} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Score Breakdown with Progress Bars */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Score Breakdown
          </CardTitle>
          <CardDescription>
            Weighted evaluation across scoring dimensions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            {
              label: "Financial Value",
              value: dealScore.financialValue,
              color: "bg-blue-500",
              desc: "Overall financial benefit of the deal",
            },
            {
              label: "Rebate Efficiency",
              value: dealScore.rebateEfficiency,
              color: "bg-purple-500",
              desc: "Likelihood and ease of earning rebates",
            },
            {
              label: "Pricing Competitiveness",
              value: dealScore.pricingCompetitiveness,
              color: "bg-emerald-500",
              desc: "Pricing compared to market benchmarks",
            },
            {
              label: "Market Share Alignment",
              value: dealScore.marketShareAlignment,
              color: "bg-amber-500",
              desc: "Compatibility with current vendor mix",
            },
            {
              label: "Compliance Likelihood",
              value: dealScore.complianceLikelihood,
              color: "bg-teal-500",
              desc: "Ability to meet contract requirements",
            },
          ].map((score) => (
            <div key={score.label} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{score.label}</span>
                <span className="text-muted-foreground">
                  {score.value}/100
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${score.color} transition-all`}
                  style={{ width: `${score.value}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {score.desc}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
