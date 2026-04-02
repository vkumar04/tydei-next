"use client"

import { useMemo } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import { formatCurrency } from "@/lib/formatting"
import { MetricCard } from "./metric-card"
import type { ContractPeriodRow } from "../report-columns"
import type { ReportData, DateRange } from "./types"

/* ─── Props ──────────────────────────────────────────────────── */

export interface OverviewTabProps {
  data: ReportData | undefined
  allPeriods: ContractPeriodRow[]
  selectedContract: unknown
  dateRange: DateRange
}

/* ─── Component ──────────────────────────────────────────────── */

export function OverviewTab({
  data,
  allPeriods,
  selectedContract,
  dateRange,
}: OverviewTabProps) {
  const totalSpend = allPeriods.reduce((s, p) => s + p.totalSpend, 0)
  const totalRebate = allPeriods.reduce((s, p) => s + p.rebateEarned, 0)
  const contractCount = data?.contracts.length ?? 0

  if (selectedContract) {
    const c = selectedContract as { name?: string; contractType?: string; status?: string }
    return (
      <>
        {/* Contract Header */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{c.name} Overview</CardTitle>
                <CardDescription>{c.contractType} Contract</CardDescription>
              </div>
              <Badge variant={c.status === "active" ? "default" : "secondary"}>
                {c.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <MetricCard label="Contract Type" value={c.contractType ?? "-"} />
              <MetricCard label="Total Spend (YTD)" value={formatCurrency(totalSpend)} />
              <MetricCard
                label="Rebate Earned"
                value={formatCurrency(totalRebate)}
                className="text-green-600 dark:text-green-400"
              />
              <MetricCard label="Days Remaining" value="287" />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Contract Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Contract Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Time Elapsed</span>
                  <span className="font-medium">78%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full" style={{ width: "78%" }}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Spend Target Progress</span>
                  <span className="font-medium">85%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full" style={{ width: "85%" }}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Rebate Collection</span>
                  <span className="font-medium">72%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-amber-500 h-2 rounded-full" style={{ width: "72%" }}></div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Monthly Spend Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Spend Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                Chart data will populate from contract periods
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Key Contract Metrics */}
        <Card>
          <CardHeader>
            <CardTitle>Key Contract Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="p-4 rounded-lg border">
                <p className="text-sm text-muted-foreground mb-1">Compliance Rate</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {totalSpend > 0 ? "94%" : "0%"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Purchases on contract</p>
              </div>
              <div className="p-4 rounded-lg border">
                <p className="text-sm text-muted-foreground mb-1">Avg Monthly Spend</p>
                <p className="text-2xl font-bold">
                  {allPeriods.length > 0
                    ? formatCurrency(Math.round(totalSpend / allPeriods.length))
                    : "$0"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Based on {allPeriods.length} months
                </p>
              </div>
              <div className="p-4 rounded-lg border">
                <p className="text-sm text-muted-foreground mb-1">Projected Annual Rebate</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(Math.round(totalRebate * 12 / Math.max(allPeriods.length, 1)))}
                </p>
                <p className="text-xs text-muted-foreground mt-1">At current pace</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </>
    )
  }

  // Build pie chart data from contracts
  const lifecycleData = useMemo(() => {
    if (!data?.contracts) return []
    const active = data.contracts.length
    return [
      { name: "Active", value: active, color: "#22c55e" },
      { name: "Expired", value: 0, color: "#ef4444" },
      { name: "Expiring", value: 0, color: "#eab308" },
    ].filter((d) => d.value > 0)
  }, [data])

  // Build monthly bar chart data from periods
  const monthlyChartData = useMemo(() => {
    const monthMap = new Map<string, { spend: number; rebate: number }>()
    for (const p of allPeriods) {
      const d = new Date(p.periodStart)
      const key = d.toLocaleString("default", { month: "short" })
      const existing = monthMap.get(key) ?? { spend: 0, rebate: 0 }
      existing.spend += p.totalSpend
      existing.rebate += p.rebateEarned
      monthMap.set(key, existing)
    }
    return Array.from(monthMap.entries()).map(([month, vals]) => ({
      month,
      spend: vals.spend,
      rebate: vals.rebate,
    }))
  }, [allPeriods])

  // All-contracts overview
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Contract Lifecycle PieChart */}
      <Card>
        <CardHeader>
          <CardTitle>Contract Life Cycle</CardTitle>
        </CardHeader>
        <CardContent>
          {lifecycleData.length > 0 ? (
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={lifecycleData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, value }: { name?: string; value?: number }) =>
                      `${name ?? ""}: ${value ?? 0}`
                    }
                  >
                    {lifecycleData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-2">
              <MetricCard label="Active Contracts" value={String(contractCount)} />
              <MetricCard label="Combined Spend" value={formatCurrency(totalSpend)} />
              <MetricCard
                label="Total Rebates"
                value={formatCurrency(totalRebate)}
                className="text-green-600 dark:text-green-400"
              />
              <MetricCard
                label="Total Volume"
                value={allPeriods
                  .reduce((s, p) => s + p.totalVolume, 0)
                  .toLocaleString()}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Earned Rebate Monthly BarChart */}
      <Card>
        <CardHeader>
          <CardTitle>Earned Rebate Monthly</CardTitle>
        </CardHeader>
        <CardContent>
          {monthlyChartData.length > 0 ? (
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <RechartsTooltip
                    formatter={(value) => [`$${Number(value).toLocaleString()}`, ""]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                    }}
                  />
                  <Legend />
                  <Bar dataKey="spend" name="Spend" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="rebate" name="Rebate" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="space-y-3">
              {data?.contracts.map((c) => {
                const spend = c.periods.reduce((s, p) => s + p.totalSpend, 0)
                const rebate = c.periods.reduce((s, p) => s + p.rebateEarned, 0)
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between text-sm border-b pb-2 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {c.contractType}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4">
                      <span>{formatCurrency(spend)}</span>
                      <span className="text-green-600 dark:text-green-400">{formatCurrency(rebate)}</span>
                    </div>
                  </div>
                )
              })}
              {(!data?.contracts || data.contracts.length === 0) && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No contract data for the selected period.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
