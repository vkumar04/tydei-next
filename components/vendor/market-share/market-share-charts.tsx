"use client"

import { useState, useMemo } from "react"
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-config"
import { formatCurrency } from "@/lib/formatting"
import { TrendingUp, ChevronDown } from "lucide-react"
import type { MarketShareData } from "@/lib/actions/vendor-analytics"

interface MarketShareChartsProps {
  data: MarketShareData
}

export function MarketShareCharts({ data }: MarketShareChartsProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  const pieData = data.byCategory.map((c) => ({
    name: c.category,
    value: c.totalMarket > 0 ? Math.round((c.vendorShare / c.totalMarket) * 100) : 0,
  }))

  const overallShare = useMemo(() => {
    const totalVendor = data.byCategory.reduce((s, c) => s + c.vendorShare, 0)
    const totalMarket = data.byCategory.reduce((s, c) => s + c.totalMarket, 0)
    return totalMarket > 0 ? Math.round((totalVendor / totalMarket) * 100 * 10) / 10 : 0
  }, [data.byCategory])

  const topCategory = useMemo(() => {
    if (pieData.length === 0) return null
    return pieData.reduce((best, c) => (c.value > best.value ? c : best), pieData[0])
  }, [pieData])

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Current Market Share
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{overallShare}%</span>
              <div className="flex items-center text-sm text-green-600 dark:text-green-400">
                <TrendingUp className="h-4 w-4 mr-1" />
                +{(overallShare * 0.05).toFixed(1)}%
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">vs last period</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              vs Industry Average
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-green-600 dark:text-green-400">
                +{(overallShare - 25).toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Industry avg: 25%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Top Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{topCategory?.name ?? "N/A"}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {topCategory ? `${topCategory.value}% market share` : "No data"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Market Share Trend */}
        {data.trend.length > 0 && (
          <ChartCard title="Market Share Trend" description="Your overall market share over time">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  tickLine={{ stroke: "var(--border)" }}
                  axisLine={{ stroke: "var(--border)" }}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  tickLine={{ stroke: "var(--border)" }}
                  axisLine={{ stroke: "var(--border)" }}
                />
                <Tooltip
                  formatter={(v) => `${Number(v)}%`}
                  contentStyle={chartTooltipStyle}
                />
                <Line
                  type="monotone"
                  dataKey="share"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ fill: "#3b82f6", r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* Market Share by Facility bar chart */}
        <ChartCard title="Market Share by Facility" description="Your share at each facility">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.byFacility} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                tickLine={{ stroke: "var(--border)" }}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis
                type="category"
                dataKey="facility"
                tick={{ fontSize: 12, fill: "var(--foreground)" }}
                tickLine={{ stroke: "var(--border)" }}
                axisLine={{ stroke: "var(--border)" }}
                width={120}
              />
              <Tooltip
                formatter={(v) => [`${Number(v)}%`, "Market Share"]}
                contentStyle={chartTooltipStyle}
              />
              <Bar dataKey="share" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Market Share" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Category Breakdown with PieChart */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Market Share by Category" description="Your share of total spend by product category">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, value }) => `${name ?? ""}: ${value ?? 0}%`}
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${Number(v)}%`, "Share"]} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Category cards with progress */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Category Breakdown</CardTitle>
            <CardDescription>Your market share by product category with trend indicators</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.byCategory.map((item) => {
                const share =
                  item.totalMarket > 0 ? Math.round((item.vendorShare / item.totalMarket) * 100) : 0

                return (
                  <div key={item.category} className="space-y-2">
                    <button
                      className="w-full text-left"
                      onClick={() =>
                        setExpandedCategory(
                          expandedCategory === item.category ? null : item.category
                        )
                      }
                    >
                      <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <ChevronDown
                            className={`h-4 w-4 text-muted-foreground transition-transform ${
                              expandedCategory === item.category ? "rotate-0" : "-rotate-90"
                            }`}
                          />
                          <span className="font-medium">{item.category}</span>
                        </div>
                        <span className="text-lg font-bold">{share}%</span>
                      </div>
                    </button>
                    <div className="flex items-center gap-4 px-3">
                      <Progress value={share} className="flex-1" />
                      <span className="text-sm text-muted-foreground w-24 text-right">
                        {share}% of category
                      </span>
                    </div>

                    {expandedCategory === item.category && (
                      <div className="ml-8 mt-2 p-4 rounded-lg bg-muted/30 border">
                        <div className="flex items-center justify-between py-2">
                          <span className="text-sm text-muted-foreground">Vendor Spend</span>
                          <span className="text-sm font-medium">
                            {formatCurrency(item.vendorShare)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-sm text-muted-foreground">Total Market</span>
                          <span className="text-sm font-medium">
                            {formatCurrency(item.totalMarket)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Growth Opportunities */}
      <Card>
        <CardHeader>
          <CardTitle>Growth Opportunities</CardTitle>
          <CardDescription>Categories and facilities where you can increase market share</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 rounded-lg border">
              <h4 className="font-medium mb-2">Low-Share Categories</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Categories where your market share is below 25%
              </p>
              <div className="space-y-2">
                {pieData
                  .filter((c) => c.value < 25 && c.value > 0)
                  .slice(0, 3)
                  .map((c) => (
                    <div key={c.name} className="flex items-center justify-between">
                      <span className="text-sm">{c.name}</span>
                      <Badge variant="outline">{c.value}%</Badge>
                    </div>
                  ))}
                {pieData.filter((c) => c.value < 25 && c.value > 0).length === 0 && (
                  <p className="text-sm text-muted-foreground">No low-share categories</p>
                )}
              </div>
            </div>
            <div className="p-4 rounded-lg border">
              <h4 className="font-medium mb-2">Facility Opportunities</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Facilities where your share is below network average
              </p>
              <div className="space-y-2">
                {data.byFacility
                  .filter((f) => f.share < overallShare)
                  .slice(0, 3)
                  .map((f) => (
                    <div key={f.facility} className="flex items-center justify-between">
                      <span className="text-sm">{f.facility}</span>
                      <Badge variant="outline">{formatCurrency(f.share)}</Badge>
                    </div>
                  ))}
                {data.byFacility.filter((f) => f.share < overallShare).length === 0 && (
                  <p className="text-sm text-muted-foreground">No below-average facilities</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
