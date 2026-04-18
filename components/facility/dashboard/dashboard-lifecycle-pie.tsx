"use client"

/**
 * Facility dashboard — contract lifecycle pie chart.
 *
 * Consumes the lifecycle distribution produced by
 * `lib/actions/dashboard/lifecycle.ts::getDashboardCharts`. Renders a
 * donut showing the active / expiring / expired / other split with a
 * legend below.
 */

import { useMemo } from "react"
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { PieChartIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { LifecycleDistribution } from "@/lib/reports/lifecycle"

interface DashboardLifecyclePieProps {
  lifecycle: LifecycleDistribution
}

type Slice = {
  key: keyof LifecycleDistribution
  name: string
  value: number
  color: string
}

export function DashboardLifecyclePie({
  lifecycle,
}: DashboardLifecyclePieProps) {
  const slices = useMemo<Slice[]>(
    () => [
      { key: "active", name: "Active", value: lifecycle.active, color: "#10b981" },
      {
        key: "expiring",
        name: "Expiring ≤90d",
        value: lifecycle.expiring,
        color: "#f59e0b",
      },
      { key: "expired", name: "Expired", value: lifecycle.expired, color: "#ef4444" },
      { key: "other", name: "Draft / Pending", value: lifecycle.other, color: "#64748b" },
    ],
    [lifecycle],
  )

  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const nonEmpty = slices.filter((s) => s.value > 0)
  const hasData = total > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <PieChartIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle>Contract Lifecycle</CardTitle>
            <CardDescription>
              Distribution across active, expiring, and expired contracts
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={nonEmpty}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={95}
                paddingAngle={2}
                label={({ percent }) =>
                  `${((percent ?? 0) * 100).toFixed(0)}%`
                }
                labelLine={false}
              >
                {nonEmpty.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value, name) => {
                  const n = Number(value)
                  return [
                    `${n} contract${n === 1 ? "" : "s"}`,
                    String(name),
                  ]
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                iconType="circle"
                wrapperStyle={{ fontSize: "0.75rem" }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[280px] flex-col items-center justify-center text-muted-foreground">
            <PieChartIcon className="mb-3 h-10 w-10 opacity-50" />
            <p className="font-medium">No contracts yet</p>
            <p className="text-xs mt-1">
              Add contracts to see lifecycle distribution
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
