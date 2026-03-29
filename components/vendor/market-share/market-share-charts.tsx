"use client"

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-config"
import type { MarketShareData } from "@/lib/actions/vendor-analytics"

interface MarketShareChartsProps {
  data: MarketShareData
}

export function MarketShareCharts({ data }: MarketShareChartsProps) {
  const pieData = data.byCategory.map((c) => ({
    name: c.category,
    value: c.totalMarket > 0 ? Math.round((c.vendorShare / c.totalMarket) * 100) : 0,
  }))

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Market Share by Category" description="Your share of total spend by product category">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, value }) => `${name}: ${value}%`}>
              {pieData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${Number(v)}%`, "Share"]} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Share by Facility" description="Your spend volume by facility">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.byFacility} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis type="number" className="text-xs" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
            <YAxis type="category" dataKey="facility" className="text-xs" width={120} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`$${Number(v).toLocaleString()}`, "Spend"]} />
            <Bar dataKey="share" fill="var(--primary)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}
