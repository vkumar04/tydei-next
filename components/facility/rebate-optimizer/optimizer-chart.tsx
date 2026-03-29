"use client"

import { useMemo } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

interface OptimizerChartProps {
  opportunities: RebateOpportunity[]
}

export function OptimizerChart({ opportunities }: OptimizerChartProps) {
  const data = useMemo(
    () =>
      opportunities.slice(0, 8).map((opp) => ({
        name:
          opp.contractName.length > 20
            ? `${opp.contractName.slice(0, 18)}...`
            : opp.contractName,
        currentSpend: opp.currentSpend,
        nextTierThreshold: opp.nextTierThreshold,
        gap: opp.spendGap,
      })),
    [opportunities]
  )

  if (data.length === 0) return null

  return (
    <ChartCard
      title="Spend vs. Tier Thresholds"
      description="Current spend compared to next tier threshold for each contract"
    >
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11 }}
            className="fill-muted-foreground"
          />
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
          <Bar dataKey="currentSpend" name="Current Spend" fill="var(--primary)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="nextTierThreshold" name="Next Tier Threshold" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} opacity={0.4} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
