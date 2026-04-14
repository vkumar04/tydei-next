"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { Building2Icon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { chartTooltipStyle } from "@/lib/chart-config"

interface SpendByVendorChartProps {
  data: { vendor: string; total: number }[]
}

function formatCurrency(value: number) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

export function SpendByVendorChart({ data }: SpendByVendorChartProps) {
  const hasData = data.length > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2Icon className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle>Top Vendors by Spend</CardTitle>
            <CardDescription>Highest spending vendors</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                type="number"
                tickFormatter={formatCurrency}
                className="text-xs"
              />
              <YAxis
                type="category"
                dataKey="vendor"
                width={100}
                className="text-xs"
                tickFormatter={(value) =>
                  value.length > 12 ? value.slice(0, 12) + "..." : value
                }
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
              />
              <Bar dataKey="total" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
            <Building2Icon className="h-10 w-10 mb-3 opacity-50" />
            <p className="font-medium">No vendor data available</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
