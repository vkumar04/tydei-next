"use client"

import { Info } from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  formatPerfCurrency,
  type MonthlyTrendPoint,
  type PerformanceRadarPoint,
} from "./performance-types"

export interface PerformanceOverviewTabProps {
  monthlyTrend: MonthlyTrendPoint[]
  radar: PerformanceRadarPoint[]
  isLoading?: boolean
}

const tooltipStyle = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--foreground)",
}

export function PerformanceOverviewTab({
  monthlyTrend,
  radar,
  isLoading,
}: PerformanceOverviewTabProps) {
  // Charles V2 audit: only axes with a real signal are charted. Stub
  // axes (delivery / quality / pricing / responsiveness) come in as
  // `null` from `getVendorPerformance` and we show them in the
  // companion list as "Not yet enabled" rather than drawing a fake
  // polygon vertex at 90.
  const populatedRadar = radar.filter(
    (r): r is PerformanceRadarPoint & { value: number } => r.value !== null,
  )
  const missingRadar = radar.filter((r) => r.value === null)

  const hasTrend = monthlyTrend.length > 0

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Spend Trend</CardTitle>
            <CardDescription>
              Vendor-scoped purchase volume over the last 12 months
              (cOGRecord.extendedPrice).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {isLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Loading trend…
                </div>
              ) : hasTrend ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      axisLine={{ stroke: "var(--border)" }}
                      tickLine={{ stroke: "var(--border)" }}
                    />
                    <YAxis
                      tickFormatter={(v) => formatPerfCurrency(v)}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      axisLine={{ stroke: "var(--border)" }}
                      tickLine={{ stroke: "var(--border)" }}
                    />
                    <Tooltip
                      formatter={(value) => formatPerfCurrency(Number(value))}
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: "var(--foreground)" }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="spend"
                      stroke="var(--chart-2)"
                      fill="var(--chart-2)"
                      fillOpacity={0.3}
                      name="Spend"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart
                  title="No spend in the last 12 months"
                  body="Once your facilities log COG against your contracts, monthly volume will appear here."
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Performance Scorecard</CardTitle>
            <CardDescription>
              Multi-dimensional metrics. Only axes with a real data
              source are plotted; the rest are listed below as
              "not yet enabled".
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              {populatedRadar.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={populatedRadar}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis
                      dataKey="metric"
                      tick={{ fill: "var(--foreground)", fontSize: 11 }}
                    />
                    <PolarRadiusAxis
                      angle={30}
                      domain={[0, 100]}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    />
                    <Radar
                      name="Performance"
                      dataKey="value"
                      stroke="var(--chart-2)"
                      fill="var(--chart-2)"
                      fillOpacity={0.3}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart
                  title="No measurable performance signals yet"
                  body="Spend Compliance unlocks once your contracts have an annual target and trailing-12-month COG. Other axes wait on data sources we haven't ingested."
                />
              )}
            </div>
            {missingRadar.length > 0 && (
              <div className="mt-3 flex flex-wrap items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <div className="flex flex-wrap items-center gap-2">
                  <span>Not yet enabled:</span>
                  {missingRadar.map((r) => (
                    <Badge key={r.metric} variant="outline">
                      {r.metric}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Rebates Earned</CardTitle>
          <CardDescription>
            Earned rebate amounts bucketed by Rebate.payPeriodEnd over
            the last 12 months.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            {hasTrend ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={{ stroke: "var(--border)" }}
                  />
                  <YAxis
                    tickFormatter={(v) => formatPerfCurrency(v)}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={{ stroke: "var(--border)" }}
                  />
                  <Tooltip
                    formatter={(value) => formatPerfCurrency(Number(value))}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "var(--foreground)" }}
                  />
                  <Bar dataKey="rebates" fill="var(--chart-1)" radius={[4, 4, 0, 0]} name="Rebates" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart
                title="No rebate periods recorded"
                body="Rebates appear here once a Rebate row's payPeriodEnd lands inside the last 12 months."
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function EmptyChart({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  )
}
