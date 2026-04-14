"use client"

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { TagIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { chartTooltipStyle } from "@/lib/chart-config"

const COLORS = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
]

interface SpendByCategoryChartProps {
  data: { name: string; value: number }[]
}

function formatCurrency(value: number) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

export function SpendByCategoryChart({ data }: SpendByCategoryChartProps) {
  const hasData = data.length > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TagIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle>Spend by Category</CardTitle>
            <CardDescription>Distribution across product categories</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {data.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-3 mt-2">
              {data.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-1.5">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: COLORS[index % COLORS.length],
                    }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {entry.name.length > 20
                      ? entry.name.slice(0, 20) + "..."
                      : entry.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
            <TagIcon className="h-10 w-10 mb-3 opacity-50" />
            <p className="font-medium">No category data available</p>
            <p className="text-xs mt-1">
              Add categories to pricing files to see spend by category
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
