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
import type { SurgeonComparison } from "@/lib/actions/cases"

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "hsl(var(--chart-3, 200 80% 50%))",
  "hsl(var(--chart-4, 40 90% 50%))",
]

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
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.15}
            />
          ))}
          <Legend />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
