"use client"

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-config"
import type { SurgeonComparison } from "@/lib/actions/cases"

interface SurgeonComparisonChartProps {
  comparison: SurgeonComparison
}

export function SurgeonComparisonChart({ comparison }: SurgeonComparisonChartProps) {
  const radarData = comparison.dimensions.map((d) => ({
    dimension: d.label,
    ...d.values,
  }))

  return (
    <ChartCard
      title="Surgeon Comparison"
      description="Multi-dimension surgeon performance radar"
    >
      <ResponsiveContainer width="100%" height={360}>
        <RadarChart data={radarData}>
          <PolarGrid className="stroke-muted" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fontSize: 11 }}
            className="fill-muted-foreground"
          />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
          {comparison.surgeons.map((name, i) => (
            <Radar
              key={name}
              name={name}
              dataKey={name}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              fillOpacity={0.15}
            />
          ))}
          <Legend />
          <Tooltip contentStyle={chartTooltipStyle} />
        </RadarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
