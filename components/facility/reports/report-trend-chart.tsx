"use client"

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { ContractPeriodRow } from "./report-columns"

interface ReportTrendChartProps {
  data: ContractPeriodRow[]
  metric: "totalSpend" | "rebateEarned" | "totalVolume"
}

const metricLabels: Record<string, string> = {
  totalSpend: "Spend",
  rebateEarned: "Rebate Earned",
  totalVolume: "Volume",
}

export function ReportTrendChart({ data, metric }: ReportTrendChartProps) {
  const chartData = data.map((p) => ({
    period: p.periodStart.split("T")[0],
    value: p[metric] ?? 0,
  }))

  return (
    <ChartCard title={`${metricLabels[metric]} Trend`} description="Over selected period">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData}>
          <XAxis dataKey="period" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={chartTooltipStyle} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
