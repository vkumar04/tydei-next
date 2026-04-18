"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getReportsOverview } from "@/lib/actions/reports/overview"
import type { ReportsDateRange } from "./reports-types"

/**
 * Overview tab: lifecycle pie chart + monthly spend/rebate bar chart +
 * top-line stats. All data pulled from `getReportsOverview`.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.2
 */
export interface ReportsOverviewTabProps {
  facilityId: string
  dateRange: ReportsDateRange
}

const LIFECYCLE_COLORS: Record<string, string> = {
  Active: "#22c55e",
  Expiring: "#eab308",
  Expired: "#ef4444",
  Other: "#94a3b8",
}

export function ReportsOverviewTab({
  facilityId,
  dateRange,
}: ReportsOverviewTabProps) {
  const { data, isLoading } = useQuery({
    queryKey: [
      "reports",
      "overview",
      facilityId,
      dateRange.from,
      dateRange.to,
    ] as const,
    queryFn: () =>
      getReportsOverview({
        dateFrom: new Date(dateRange.from),
        dateTo: new Date(dateRange.to),
      }),
  })

  const pieData = useMemo(() => {
    if (!data) return []
    return [
      { name: "Active", value: data.lifecycle.active },
      { name: "Expiring", value: data.lifecycle.expiring },
      { name: "Expired", value: data.lifecycle.expired },
      { name: "Other", value: data.lifecycle.other },
    ].filter((d) => d.value > 0)
  }, [data])

  if (isLoading || !data) {
    return <Skeleton className="h-[500px] rounded-xl" />
  }

  return (
    <div className="space-y-6">
      {/* Top-line stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total Contracts" value={String(data.stats.totalContracts)} />
        <StatCard
          label="Total Contract Value"
          value={formatCurrency(data.stats.totalValue)}
        />
        <StatCard
          label="Total Rebates"
          value={formatCurrency(data.stats.totalRebates)}
          accent="text-green-600 dark:text-green-400"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Lifecycle pie */}
        <Card>
          <CardHeader>
            <CardTitle>Contract Lifecycle</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">
                No contracts in scope.
              </p>
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={4}
                      dataKey="value"
                      label={({ name, value }: { name?: string; value?: number }) =>
                        `${name ?? ""}: ${value ?? 0}`
                      }
                    >
                      {pieData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={LIFECYCLE_COLORS[entry.name] ?? "#6b7280"}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly trend bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Spend &amp; Rebate</CardTitle>
          </CardHeader>
          <CardContent>
            {data.monthlyTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">
                No spend or rebates in the selected range.
              </p>
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.monthlyTrend}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(v: number) =>
                        `$${(v / 1000).toFixed(0)}k`
                      }
                      tick={{ fill: "var(--muted-foreground)" }}
                    />
                    <RechartsTooltip
                      formatter={(value) => [
                        `$${Number(value).toLocaleString()}`,
                        "",
                      ]}
                      contentStyle={{
                        backgroundColor: "var(--card)",
                        border: "1px solid var(--border)",
                      }}
                    />
                    <Legend />
                    <Bar
                      dataKey="spend"
                      name="Spend"
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="rebate"
                      name="Rebate"
                      fill="#22c55e"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${accent ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  )
}
