"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { ContractPeriodRow } from "./report-columns"

interface ReportTrendChartProps {
  data: ContractPeriodRow[]
  metric: "totalSpend" | "rebateEarned" | "totalVolume"
  reportType?: string
}

const metricLabels: Record<string, string> = {
  totalSpend: "Spend",
  rebateEarned: "Rebate Earned",
  totalVolume: "Volume",
}

export function ReportTrendChart({ data, metric, reportType }: ReportTrendChartProps) {
  const chartData = data.map((p) => ({
    period: p.periodStart.split("T")[0],
    spend: p.totalSpend,
    rebateEarned: p.rebateEarned,
    rebateCollected: p.rebateCollected,
    volume: p.totalVolume,
    paymentExpected: p.paymentExpected,
    paymentActual: p.paymentActual,
    value: p[metric] ?? 0,
  }))

  // Determine which bars to show based on report type
  const isService = reportType === "service" || reportType === "capital"
  const isTieIn = reportType === "tie_in"

  const barTitle = isService
    ? "Expected vs Actual Payments"
    : isTieIn
    ? "Spend vs Rebate Earned"
    : `${metricLabels[metric]} by Period`

  return (
    <ChartCard title={barTitle} description="Over selected period">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis
            tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`}
            tick={{ fill: "hsl(var(--muted-foreground))" }}
          />
          <Tooltip
            formatter={(value) => [`$${Number(value).toLocaleString()}`, ""]}
            contentStyle={chartTooltipStyle}
          />
          <Legend />
          {isService ? (
            <>
              <Bar
                dataKey="paymentExpected"
                name="Expected Payment"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="paymentActual"
                name="Payments Made"
                fill="#10b981"
                radius={[4, 4, 0, 0]}
              />
            </>
          ) : (
            <>
              <Bar
                dataKey="spend"
                name="Spend"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="rebateEarned"
                name="Rebate Earned"
                fill="#10b981"
                radius={[4, 4, 0, 0]}
              />
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
