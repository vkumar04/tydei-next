"use client"

import { useMemo } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { CaseWithRelations } from "@/lib/actions/cases"

interface CostDistributionChartProps {
  cases: CaseWithRelations[]
}

export function CostDistributionChart({ cases }: CostDistributionChartProps) {
  const data = useMemo(() => {
    if (cases.length === 0) return []
    const sorted = [...cases].sort((a, b) => a.totalSpend - b.totalSpend)
    const bucketSize = Math.ceil(sorted.length / 10)
    const buckets: { range: string; count: number; avgSpend: number }[] = []

    for (let i = 0; i < sorted.length; i += bucketSize) {
      const slice = sorted.slice(i, i + bucketSize)
      const min = Math.round(slice[0]!.totalSpend)
      const max = Math.round(slice[slice.length - 1]!.totalSpend)
      buckets.push({
        range: `$${min.toLocaleString()}-$${max.toLocaleString()}`,
        count: slice.length,
        avgSpend: slice.reduce((s, c) => s + c.totalSpend, 0) / slice.length,
      })
    }
    return buckets
  }, [cases])

  if (data.length === 0) return null

  return (
    <ChartCard title="Cost Distribution" description="Cases grouped by spend range">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="range" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
          <YAxis className="fill-muted-foreground" tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={chartTooltipStyle} />
          <Bar dataKey="count" name="Cases" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
