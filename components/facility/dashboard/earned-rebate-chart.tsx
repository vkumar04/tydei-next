"use client"

import { useMemo } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-config"

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
          <Tooltip contentStyle={chartTooltipStyle} />
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
