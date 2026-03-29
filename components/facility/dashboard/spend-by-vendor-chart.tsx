"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"

interface SpendByVendorChartProps {
  data: { vendor: string; total: number }[]
}

export function SpendByVendorChart({ data }: SpendByVendorChartProps) {
  return (
    <ChartCard title="Spend by Vendor" description="Top vendors by total spend">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical">
          <XAxis type="number" tick={{ fontSize: 12 }} />
          <YAxis dataKey="vendor" type="category" width={120} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="total" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
