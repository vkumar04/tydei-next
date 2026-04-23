"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatCurrency } from "@/lib/formatting"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

/**
 * Stacked horizontal bar chart showing "Earned" vs "Potential"
 * additional rebate per contract. Lives inside the Earnings tab on
 * the rebate-optimizer page.
 */
export interface EarningsChartProps {
  opportunities: RebateOpportunity[]
}

export function EarningsChart({ opportunities }: EarningsChartProps) {
  const data = opportunities.map((o) => ({
    name: o.contractName,
    vendor: o.vendorName,
    earned: (o.currentSpend * (o.currentRebatePercent || 0)) / 100,
    potential: o.projectedAdditionalRebate,
  }))

  if (data.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No earnings data to chart.
      </p>
    )
  }

  return (
    <div className="h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            type="number"
            tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}K`}
            tick={{ fill: "var(--muted-foreground)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fill: "var(--foreground)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={{ stroke: "var(--border)" }}
          />
          <Tooltip
            formatter={(value) => formatCurrency(Number(value))}
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--foreground)",
            }}
            labelStyle={{ color: "var(--foreground)" }}
          />
          <Bar
            dataKey="earned"
            name="Earned"
            stackId="a"
            fill="var(--chart-1)"
            radius={[0, 4, 4, 0]}
          />
          <Bar
            dataKey="potential"
            name="Potential"
            stackId="a"
            fill="var(--chart-2)"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
