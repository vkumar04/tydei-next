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
import { DollarSign } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { chartTooltipStyle } from "@/lib/chart-config"
import { formatCompactCurrency } from "@/lib/formatting"

interface VendorSpendChartProps {
  data: { month: string; spend: number; rebate: number }[]
}

export function VendorSpendChart({ data }: VendorSpendChartProps) {
  const hasData = data.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aggregate Sales Trend</CardTitle>
        <CardDescription>
          Total on-contract sales across all facilities
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" className="text-xs" />
              <YAxis tickFormatter={(value) => formatCompactCurrency(Number(value))} className="text-xs" />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value) => [formatCompactCurrency(Number(value)), "Sales"]}
                labelFormatter={(label) => `Month: ${label}`}
              />
              <Line
                type="monotone"
                dataKey="spend"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={{ fill: "var(--primary)" }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center h-[280px] text-muted-foreground">
            <DollarSign className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No sales data available</p>
            <p className="text-sm">
              Sales trends will appear once COG data is loaded
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
