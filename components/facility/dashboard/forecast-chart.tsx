"use client"

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"

interface DataPoint {
  period: string
  actual: number | null
  forecast: number | null
  lower: number | null
  upper: number | null
}

interface ForecastChartProps {
  data: DataPoint[]
  metric: "spend" | "rebate"
}

export function ForecastChart({ data, metric }: ForecastChartProps) {
  const title = metric === "spend" ? "Spend Forecast" : "Rebate Forecast"

  return (
    <ChartCard title={title} description="Projected values with confidence band">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="period" className="text-xs" />
          <YAxis className="text-xs" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`$${Number(v).toLocaleString()}`, ""]} />
          <Area
            dataKey="upper"
            stroke="none"
            fill="var(--primary)"
            fillOpacity={0.05}
          />
          <Area
            dataKey="lower"
            stroke="none"
            fill="var(--background)"
            fillOpacity={1}
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            stroke="var(--primary)"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={{ r: 3, strokeDasharray: "" }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
