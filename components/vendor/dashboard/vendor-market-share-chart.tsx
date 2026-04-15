"use client"

import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { PieChart as PieChartIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { chartTooltipStyle } from "@/lib/chart-config"

interface VendorMarketShareChartProps {
  data: { category: string; share: number }[]
}

export function VendorMarketShareChart({ data }: VendorMarketShareChartProps) {
  const hasData = data.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Market Share by Category</CardTitle>
        <CardDescription>Percentage of total category spend</CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data} layout="vertical">
              <XAxis
                type="number"
                domain={[0, 100]}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v}%`}
              />
              <YAxis
                dataKey="category"
                type="category"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                width={100}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(v) => [`${Number(v).toFixed(1)}%`, "Share"]}
              />
              <Bar
                dataKey="share"
                fill="var(--primary)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center h-[280px] text-muted-foreground">
            <PieChartIcon className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No market share data</p>
            <p className="text-sm">
              Market share will be calculated from COG data
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
