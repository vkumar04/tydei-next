"use client"

import { useMemo } from "react"
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-config"

interface SpendTrendItem {
  month: string
  vendorName?: string
  categoryName?: string
  spend: number
}

interface SpendTrendChartProps {
  data: SpendTrendItem[]
  groupBy: "vendor" | "category"
}

export function SpendTrendChart({ data, groupBy }: SpendTrendChartProps) {
  const { chartData, groups } = useMemo(() => {
    const nameKey = groupBy === "vendor" ? "vendorName" : "categoryName"
    const groupSet = new Set<string>()
    const monthMap = new Map<string, Record<string, number>>()

    for (const item of data) {
      const name = ((item as unknown as Record<string, unknown>)[nameKey] as string) ?? "Other"
      groupSet.add(name)
      const entry = monthMap.get(item.month) ?? {}
      entry[name] = (entry[name] ?? 0) + item.spend
      monthMap.set(item.month, entry)
    }

    const months = Array.from(monthMap.keys()).sort()
    const chartData = months.map((month) => {
      const vals = monthMap.get(month) ?? {}
      const total = Object.values(vals).reduce((s, v) => s + v, 0)
      return { month, ...vals, total }
    })

    return { chartData, groups: Array.from(groupSet).slice(0, 5) }
  }, [data, groupBy])

  const COLORS = CHART_COLORS

  return (
    <ChartCard
      title={`${groupBy === "vendor" ? "Vendor" : "Category"} Spend Trends`}
      description="Monthly spend breakdown with trend line"
    >
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
          <YAxis
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            className="fill-muted-foreground"
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(value) => [`$${Number(value).toLocaleString()}`, ""]}
            contentStyle={chartTooltipStyle}
          />
          <Legend />
          {groups.map((name, i) => (
            <Bar
              key={name}
              dataKey={name}
              stackId="stack"
              fill={COLORS[i % COLORS.length]}
              radius={i === groups.length - 1 ? [4, 4, 0, 0] : undefined}
            />
          ))}
          <Line
            type="monotone"
            dataKey="total"
            name="Total"
            stroke="var(--foreground)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
