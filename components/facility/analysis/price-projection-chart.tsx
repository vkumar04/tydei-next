"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import type { PriceProjection } from "@/lib/actions/analysis"

interface PriceProjectionChartProps {
  projections: PriceProjection[]
}

export function PriceProjectionChart({ projections }: PriceProjectionChartProps) {
  const data = projections.map((p) => ({
    month: p.month,
    projected: p.projectedPrice,
    current: p.currentPrice,
  }))

  return (
    <ChartCard
      title="Price Projections"
      description="Projected price trends over upcoming periods"
    >
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
          <YAxis
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            className="fill-muted-foreground"
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(value) => [`$${Number(value).toFixed(2)}`, ""]}
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
            }}
          />
          <ReferenceLine
            y={data[0]?.current ?? 0}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="3 3"
            label="Current"
          />
          <Line
            type="monotone"
            dataKey="projected"
            name="Projected Price"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
