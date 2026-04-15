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
import type { ContractPeriodRow } from "./report-columns"

interface ReportTrendChartProps {
  data: ContractPeriodRow[]
  metric: "totalSpend" | "rebateEarned" | "totalVolume"
  reportType?: string
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

  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis
            tickFormatter={(value: number) => `${(value / 1000).toFixed(0)}k`}
            tick={{ fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            formatter={(value) => [`$${Number(value).toLocaleString()}`, ""]}
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
            }}
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
                fill="#22c55e"
                radius={[4, 4, 0, 0]}
              />
            </>
          ) : isTieIn ? (
            <>
              <Bar
                dataKey="spend"
                name="Monthly Spend"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="rebateEarned"
                name="Target Spend"
                fill="#22c55e"
                radius={[4, 4, 0, 0]}
              />
            </>
          ) : (
            <>
              <Bar
                dataKey="spend"
                name="Monthly Spend"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="rebateEarned"
                name="Rebate Earned"
                fill="#22c55e"
                radius={[4, 4, 0, 0]}
              />
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
