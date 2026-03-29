"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"

interface SpendTierChartProps {
  data: {
    vendor: string
    contractName: string
    currentSpend: number
    tiers: { tier: number; threshold: number }[]
  }[]
}

export function SpendTierChart({ data }: SpendTierChartProps) {
  const chartData = data.map((item) => {
    const entry: Record<string, string | number> = {
      name: `${item.vendor} - ${item.contractName}`.slice(0, 30),
      "Current Spend": item.currentSpend,
    }
    for (const t of item.tiers) {
      entry[`Tier ${t.tier}`] = t.threshold
    }
    return entry
  })

  const tierKeys = Array.from(
    new Set(data.flatMap((d) => d.tiers.map((t) => `Tier ${t.tier}`)))
  ).sort()

  return (
    <ChartCard title="Spend vs Tier Thresholds" description="Current spend relative to tier targets">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="Current Spend" fill="var(--chart-1)" />
          {tierKeys.map((key, i) => (
            <Bar key={key} dataKey={key} fill={`var(--chart-${(i % 4) + 2})`} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
