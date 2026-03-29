"use client"

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"

interface PerformanceRadarProps {
  scores: {
    compliance: number
    delivery: number
    quality: number
    pricing: number
  }
}

export function PerformanceRadar({ scores }: PerformanceRadarProps) {
  const data = [
    { dimension: "Compliance", score: Math.round(scores.compliance) },
    { dimension: "Delivery", score: Math.round(scores.delivery) },
    { dimension: "Quality", score: Math.round(scores.quality) },
    { dimension: "Pricing", score: Math.round(scores.pricing) },
  ]

  return (
    <ChartCard title="Performance Radar" description="Multi-dimension vendor performance">
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data}>
          <PolarGrid className="stroke-muted" />
          <PolarAngleAxis dataKey="dimension" className="text-xs" />
          <PolarRadiusAxis domain={[0, 100]} tick={false} />
          <Radar
            dataKey="score"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
