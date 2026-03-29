"use client"

import { useMemo } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

interface EarnedRebateChartProps {
  data: Record<string, string | number>[]
}

export function EarnedRebateChart({ data }: EarnedRebateChartProps) {
  const vendorKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const entry of data) {
      for (const key of Object.keys(entry)) {
        if (key !== "month") keys.add(key)
      }
    }
    return Array.from(keys)
  }, [data])

  return (
    <ChartCard title="Earned Rebate by Month" description="Stacked by vendor">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          {vendorKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="rebate"
              fill={CHART_COLORS[i % CHART_COLORS.length]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
