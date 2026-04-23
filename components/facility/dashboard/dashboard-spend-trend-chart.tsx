"use client"

/**
 * Facility dashboard — monthly spend + rebate grouped bar chart.
 *
 * Consumes `MonthlyTrendPoint[]` from
 * `lib/actions/dashboard/lifecycle.ts::getDashboardCharts.monthlyTrend`.
 * Shows 12 months of spend (emerald) and rebate (sky) side-by-side.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { TrendingUpIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { MonthlyTrendPoint } from "@/lib/reports/monthly-trend"

interface DashboardSpendTrendChartProps {
  data: MonthlyTrendPoint[]
}

function formatCurrencyShort(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

/** Convert YYYY-MM to a compact "Mon YY" label. */
function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split("-").map((p) => Number(p))
  if (!year || !month) return ym
  const d = new Date(Date.UTC(year, month - 1, 1))
  return d.toLocaleString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  })
}

export function DashboardSpendTrendChart({
  data,
}: DashboardSpendTrendChartProps) {
  const total = data.reduce((sum, p) => sum + p.spend + p.rebate, 0)
  const hasData = total > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUpIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle>Monthly Spend & Rebate</CardTitle>
            <CardDescription>
              Rolling 12-month spend alongside rebate earned
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="month"
                tickFormatter={formatMonthLabel}
                className="text-xs"
              />
              <YAxis
                tickFormatter={formatCurrencyShort}
                className="text-xs"
                width={60}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelFormatter={(label) =>
                  typeof label === "string" ? formatMonthLabel(label) : label
                }
                formatter={(value, name) => [
                  formatCurrencyShort(Number(value)),
                  String(name),
                ]}
              />
              <Legend
                verticalAlign="top"
                height={28}
                iconType="circle"
                wrapperStyle={{ fontSize: "0.75rem" }}
              />
              <Bar dataKey="spend" name="Spend" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <Bar
                dataKey="rebate"
                name="Rebate"
                fill="var(--chart-2)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[320px] flex-col items-center justify-center text-muted-foreground">
            <TrendingUpIcon className="mb-3 h-10 w-10 opacity-50" />
            <p className="font-medium">No spend activity in last 12 months</p>
            <p className="text-xs mt-1">Import COG data to see trend</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
