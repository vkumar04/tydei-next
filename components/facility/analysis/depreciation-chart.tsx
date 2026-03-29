"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import type { DepreciationSchedule } from "@/lib/analysis/depreciation"

interface DepreciationChartProps {
  schedule: DepreciationSchedule
}

export function DepreciationChart({ schedule }: DepreciationChartProps) {
  const data = schedule.years.map((y) => ({
    year: `Yr ${y.year}`,
    depreciation: y.depreciation,
    bookValue: y.bookValue,
  }))

  return (
    <ChartCard
      title="Depreciation Schedule"
      description={`${schedule.recoveryPeriod}-year MACRS (${schedule.convention.replace("_", " ")})`}
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
          <YAxis
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            className="fill-muted-foreground"
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(value) => [`$${Number(value).toLocaleString()}`, ""]}
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
            }}
          />
          <Bar
            dataKey="depreciation"
            name="Depreciation"
            fill="hsl(var(--primary))"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
