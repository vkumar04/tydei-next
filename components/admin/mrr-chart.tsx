"use client"

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"

interface MRRChartProps {
  data: { month: string; mrr: number }[]
}

export function MRRChart({ data }: MRRChartProps) {
  return (
    <ChartCard title="MRR Over Time" description="Monthly recurring revenue trend">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="month" className="text-xs" />
          <YAxis className="text-xs" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`$${Number(v).toLocaleString()}`, "MRR"]} />
          <Area
            type="monotone"
            dataKey="mrr"
            stroke="var(--primary)"
            fill="var(--primary)"
            fillOpacity={0.1}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
