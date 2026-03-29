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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { chartTooltipStyle } from "@/lib/chart-config"

interface PerformanceRadarProps {
  scores: {
    compliance: number
    delivery: number
    quality: number
    pricing: number
    responseTime?: number
  }
}

export function PerformanceRadar({ scores }: PerformanceRadarProps) {
  const data = [
    { metric: "Spend Compliance", value: Math.round(scores.compliance) },
    { metric: "On-Time Delivery", value: Math.round(scores.delivery) },
    { metric: "Quality Score", value: Math.round(scores.quality) },
    { metric: "Pricing", value: Math.round(scores.pricing) },
    { metric: "Response Time", value: Math.round(scores.responseTime ?? 89) },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Performance Scorecard</CardTitle>
        <CardDescription>Multi-dimensional performance metrics</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data}>
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis
                dataKey="metric"
                tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }}
              />
              <PolarRadiusAxis
                angle={30}
                domain={[0, 100]}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              />
              <Radar
                name="Performance"
                dataKey="value"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.3}
              />
              <Tooltip contentStyle={chartTooltipStyle} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
