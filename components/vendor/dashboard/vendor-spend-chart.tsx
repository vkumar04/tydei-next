"use client"

import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, Legend,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"

interface VendorSpendChartProps {
  data: { month: string; spend: number; rebate: number }[]
}

export function VendorSpendChart({ data }: VendorSpendChartProps) {
  return (
    <ChartCard title="Spend & Rebate Trend" description="Monthly spend and rebates">
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="month" className="text-xs" />
          <YAxis className="text-xs" />
          <Tooltip
            contentStyle={chartTooltipStyle}
            formatter={(value) =>
              new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value))
            }
          />
          <Legend />
          <Bar dataKey="spend" fill="var(--primary)" name="Spend" radius={[4, 4, 0, 0]} />
          <Line dataKey="rebate" stroke="var(--chart-2)" name="Rebate" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
