"use client"

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { DealScore } from "@/lib/actions/prospective"

interface DealScoreRadarProps {
  score: DealScore
}

const RECOMMENDATION_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  strong_accept: { label: "Strong Accept", variant: "default" },
  accept: { label: "Accept", variant: "default" },
  negotiate: { label: "Negotiate", variant: "secondary" },
  reject: { label: "Reject", variant: "destructive" },
}

export function DealScoreRadar({ score }: DealScoreRadarProps) {
  const data = [
    { dimension: "Financial Value", value: score.financialValue },
    { dimension: "Rebate Efficiency", value: score.rebateEfficiency },
    { dimension: "Pricing Competitiveness", value: score.pricingCompetitiveness },
    { dimension: "Market Share", value: score.marketShareAlignment },
    { dimension: "Compliance", value: score.complianceLikelihood },
  ]

  const rec = RECOMMENDATION_LABELS[score.recommendation] ?? RECOMMENDATION_LABELS.negotiate!

  return (
    <ChartCard
      title="Deal Score"
      description={`Overall: ${score.overall}/100 — ${rec.label}`}
    >
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data}>
          <PolarGrid className="stroke-muted" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fontSize: 10 }}
            className="fill-muted-foreground"
          />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
          <Radar
            name="Score"
            dataKey="value"
            stroke="var(--primary)"
            fill="var(--primary)"
            fillOpacity={0.2}
          />
          <Tooltip contentStyle={chartTooltipStyle} />
        </RadarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
