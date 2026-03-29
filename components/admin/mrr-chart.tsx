"use client"

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { TrendingUp } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { chartTooltipStyle } from "@/lib/chart-config"
import { formatCurrency } from "@/lib/formatting"

interface MRRChartProps {
  data: { month: string; mrr: number }[]
  subscriptions?: number
}

export function MRRChart({ data, subscriptions = 0 }: MRRChartProps) {
  const currentMrr = data.length > 0 ? data[data.length - 1].mrr : 0
  const avgRevenuePerAccount = subscriptions > 0 ? Math.round(currentMrr / subscriptions) : 0

  return (
    <div className="space-y-6">
      {/* MRR Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Monthly Recurring Revenue
          </CardTitle>
          <CardDescription>Platform subscription metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Current MRR</p>
              <p className="text-3xl font-bold">{formatCurrency(currentMrr)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Active Subscriptions</p>
              <p className="text-3xl font-bold">{subscriptions}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Avg. Revenue per Account</p>
              <p className="text-3xl font-bold">{formatCurrency(avgRevenuePerAccount)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MRR Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">MRR Over Time</CardTitle>
          <CardDescription>Monthly recurring revenue trend</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  )
}
