"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { TrendingUpIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { chartTooltipStyle } from "@/lib/chart-config"

interface TotalSpendChartProps {
  data: { month: string; spend: number }[]
}

function formatCurrency(value: number) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

export function TotalSpendChart({ data }: TotalSpendChartProps) {
  const hasData = data.length > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUpIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle>Total Spend</CardTitle>
            <CardDescription>Monthly spend over time</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" className="text-xs" />
              <YAxis tickFormatter={formatCurrency} className="text-xs" />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
                labelFormatter={(label) => `Month: ${label}`}
              />
              <Line
                type="monotone"
                dataKey="spend"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ fill: "#10b981" }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
            <TrendingUpIcon className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No spend data available</p>
            <p className="text-sm">Import COG data to see charts</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
