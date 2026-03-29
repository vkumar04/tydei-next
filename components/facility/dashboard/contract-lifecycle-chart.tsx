"use client"

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"

interface ContractLifecycleChartProps {
  data: { active: number; expired: number; expiring: number }
}

const SEGMENTS = [
  { key: "active", label: "Active", color: "var(--chart-1)" },
  { key: "expired", label: "Expired", color: "var(--chart-4)" },
  { key: "expiring", label: "Expiring", color: "var(--chart-3)" },
] as const

export function ContractLifecycleChart({ data }: ContractLifecycleChartProps) {
  const chartData = SEGMENTS.map((s) => ({
    name: s.label,
    value: data[s.key],
    color: s.color,
  })).filter((d) => d.value > 0)

  return (
    <ChartCard title="Contract Lifecycle" description="Active vs expired vs expiring">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            dataKey="value"
            nameKey="name"
            paddingAngle={2}
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
