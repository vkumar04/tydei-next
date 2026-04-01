"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CostDistributionChart } from "@/components/facility/case-costing/cost-distribution-chart"
import { useCaseCostingReport, useCases } from "@/hooks/use-case-costing"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react"

interface CaseCostingReportsClientProps {
  facilityId: string
}

type ReportType = "surgeon" | "procedure" | "trends"
type DateRange = "3mo" | "6mo" | "12mo" | "all"

function getDateFrom(range: DateRange): string | undefined {
  if (range === "all") return undefined
  const d = new Date()
  if (range === "3mo") d.setMonth(d.getMonth() - 3)
  else if (range === "6mo") d.setMonth(d.getMonth() - 6)
  else if (range === "12mo") d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().slice(0, 10)
}

export function CaseCostingReportsClient({ facilityId }: CaseCostingReportsClientProps) {
  const [reportType, setReportType] = useState<ReportType>("surgeon")
  const [dateRange, setDateRange] = useState<DateRange>("12mo")
  const [activeTab, setActiveTab] = useState("surgeon-comparison")

  const dateFrom = getDateFrom(dateRange)

  const { data: report, isLoading } = useCaseCostingReport(facilityId)
  const { data: casesData } = useCases(facilityId, {
    pageSize: 500,
    ...(dateFrom ? { dateFrom } : {}),
  })

  const cases = casesData?.cases ?? []

  // ─── Surgeon Performance Data ──────────────────────────────────
  const surgeonStats = useMemo(() => {
    const map = new Map<
      string,
      {
        cases: number
        totalSpend: number
        totalReimbursement: number
        totalMargin: number
        compliant: number
      }
    >()
    for (const c of cases) {
      const name = c.surgeonName ?? "Unknown"
      const entry = map.get(name) ?? {
        cases: 0,
        totalSpend: 0,
        totalReimbursement: 0,
        totalMargin: 0,
        compliant: 0,
      }
      entry.cases++
      entry.totalSpend += c.totalSpend
      entry.totalReimbursement += c.totalReimbursement
      entry.totalMargin += c.margin
      if (c.complianceStatus === "compliant") entry.compliant++
      map.set(name, entry)
    }
    return Array.from(map.entries())
      .map(([name, d]) => ({
        name,
        cases: d.cases,
        totalSpend: d.totalSpend,
        avgMargin: d.cases > 0 ? d.totalMargin / d.cases : 0,
        complianceRate: d.cases > 0 ? (d.compliant / d.cases) * 100 : 0,
        totalReimbursement: d.totalReimbursement,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend)
  }, [cases])

  // ─── CPT Procedure Analysis Data ───────────────────────────────
  const cptStats = useMemo(() => {
    const map = new Map<
      string,
      { count: number; costs: number[] }
    >()
    for (const c of cases) {
      const code = c.primaryCptCode ?? "N/A"
      const entry = map.get(code) ?? { count: 0, costs: [] }
      entry.count++
      entry.costs.push(c.totalSpend)
      map.set(code, entry)
    }
    return Array.from(map.entries())
      .map(([code, d]) => {
        const sorted = [...d.costs].sort((a, b) => a - b)
        const avg = d.costs.reduce((s, v) => s + v, 0) / d.costs.length
        return {
          code,
          count: d.count,
          avgCost: avg,
          minCost: sorted[0] ?? 0,
          maxCost: sorted[sorted.length - 1] ?? 0,
        }
      })
      .sort((a, b) => b.count - a.count)
  }, [cases])

  // ─── Monthly Summary Table Data ────────────────────────────────
  const monthlySummary = useMemo(() => {
    const map = new Map<
      string,
      { cases: number; spend: number; reimbursement: number }
    >()
    for (const c of cases) {
      const month = c.dateOfSurgery.slice(0, 7)
      const entry = map.get(month) ?? { cases: 0, spend: 0, reimbursement: 0 }
      entry.cases++
      entry.spend += c.totalSpend
      entry.reimbursement += c.totalReimbursement
      map.set(month, entry)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month,
        cases: d.cases,
        spend: d.spend,
        reimbursement: d.reimbursement,
        margin: d.reimbursement - d.spend,
      }))
  }, [cases])

  // ─── Rebate Contribution Data ──────────────────────────────────
  const rebateStats = useMemo(() => {
    const map = new Map<
      string,
      { cases: number; spend: number; compliant: number }
    >()
    for (const c of cases) {
      const name = c.surgeonName ?? "Unknown"
      const entry = map.get(name) ?? { cases: 0, spend: 0, compliant: 0 }
      entry.cases++
      entry.spend += c.totalSpend
      if (c.complianceStatus === "compliant") entry.compliant++
      map.set(name, entry)
    }
    return Array.from(map.entries())
      .map(([name, d]) => ({
        name,
        cases: d.cases,
        spend: d.spend,
        estRebate: d.spend * 0.03,
        complianceRate: d.cases > 0 ? (d.compliant / d.cases) * 100 : 0,
      }))
      .sort((a, b) => b.estRebate - a.estRebate)
  }, [cases])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    )
  }

  if (!report) return null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Case Costing Reports"
        description="Summary metrics and trends for surgical case costs"
        action={
          <Link href="/dashboard/case-costing">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 size-4" /> Back to Case Costing
            </Button>
          </Link>
        }
      />

      {/* ─── Filter Bar ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={reportType}
          onValueChange={(v) => setReportType(v as ReportType)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Report type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="surgeon">Surgeon Comparison</SelectItem>
            <SelectItem value="procedure">Procedure Analysis</SelectItem>
            <SelectItem value="trends">Cost Trends</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={dateRange}
          onValueChange={(v) => setDateRange(v as DateRange)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3mo">Last 3 Months</SelectItem>
            <SelectItem value="6mo">Last 6 Months</SelectItem>
            <SelectItem value="12mo">Last 12 Months</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>

        <Badge variant="secondary" className="text-xs">
          {cases.length} cases
        </Badge>
      </div>

      {/* ─── Stat Cards ──────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total Cases" value={report.totalCases.toLocaleString()} />
        <StatCard label="Total Spend" value={`$${Math.round(report.totalSpend).toLocaleString()}`} />
        <StatCard label="Avg Cost/Case" value={`$${Math.round(report.avgCostPerCase).toLocaleString()}`} />
        <StatCard label="Total Reimbursement" value={`$${Math.round(report.totalReimbursement).toLocaleString()}`} />
        <StatCard label="Avg Margin" value={`$${Math.round(report.avgMargin).toLocaleString()}`} />
        <StatCard label="Compliance Rate" value={`${Math.round(report.complianceRate)}%`} />
      </div>

      {/* ─── Cost Distribution Chart ─────────────────────────────── */}
      <CostDistributionChart cases={cases} />

      {/* ─── 4-Tab Section ───────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="surgeon-comparison">Surgeon Comparison</TabsTrigger>
          <TabsTrigger value="procedure-analysis">Procedure Analysis</TabsTrigger>
          <TabsTrigger value="cost-trends">Cost Trends</TabsTrigger>
          <TabsTrigger value="rebate-contribution">Rebate Contribution</TabsTrigger>
        </TabsList>

        {/* ─── Tab 1: Surgeon Comparison ─────────────────────────── */}
        <TabsContent value="surgeon-comparison">
          <Card>
            <CardHeader>
              <CardTitle>Surgeon Performance</CardTitle>
            </CardHeader>
            <CardContent>
              {surgeonStats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No surgeon data available.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Surgeon</TableHead>
                      <TableHead className="text-right">Cases</TableHead>
                      <TableHead className="text-right">Total Spend</TableHead>
                      <TableHead className="text-right">Avg Margin</TableHead>
                      <TableHead className="text-right">Compliance %</TableHead>
                      <TableHead className="text-right">Trend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {surgeonStats.map((s) => (
                      <TableRow key={s.name}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-right">{s.cases}</TableCell>
                        <TableCell className="text-right">
                          ${Math.round(s.totalSpend).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={
                              s.avgMargin >= 0
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400"
                            }
                          >
                            ${Math.round(s.avgMargin).toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={
                              s.complianceRate >= 80
                                ? "default"
                                : s.complianceRate >= 50
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {Math.round(s.complianceRate)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {s.avgMargin >= 0 ? (
                            <TrendingUp className="ml-auto size-4 text-green-600 dark:text-green-400" />
                          ) : (
                            <TrendingDown className="ml-auto size-4 text-red-600 dark:text-red-400" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab 2: Procedure Analysis ─────────────────────────── */}
        <TabsContent value="procedure-analysis">
          <Card>
            <CardHeader>
              <CardTitle>CPT Code Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {cptStats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No procedure data available.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CPT Code</TableHead>
                      <TableHead className="text-right">Case Count</TableHead>
                      <TableHead className="text-right">Avg Cost</TableHead>
                      <TableHead className="text-right">Min Cost</TableHead>
                      <TableHead className="text-right">Max Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cptStats.map((p) => (
                      <TableRow key={p.code}>
                        <TableCell className="font-medium font-mono">
                          {p.code}
                        </TableCell>
                        <TableCell className="text-right">{p.count}</TableCell>
                        <TableCell className="text-right">
                          ${Math.round(p.avgCost).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Math.round(p.minCost).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Math.round(p.maxCost).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab 3: Cost Trends ────────────────────────────────── */}
        <TabsContent value="cost-trends" className="space-y-6">
          {report.monthlyCosts.length > 0 && (
            <ChartCard title="Monthly Costs" description="Spend vs. reimbursement by month">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={report.monthlyCosts}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <YAxis
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                    className="fill-muted-foreground"
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v) => [`$${Number(v).toLocaleString()}`, ""]}
                    contentStyle={chartTooltipStyle}
                  />
                  <Bar dataKey="spend" name="Spend" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="reimbursement" name="Reimbursement" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} opacity={0.5} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Monthly Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {monthlySummary.length === 0 ? (
                <p className="text-sm text-muted-foreground">No monthly data available.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Cases</TableHead>
                      <TableHead className="text-right">Total Spend</TableHead>
                      <TableHead className="text-right">Reimbursement</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlySummary.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="font-medium">{m.month}</TableCell>
                        <TableCell className="text-right">{m.cases}</TableCell>
                        <TableCell className="text-right">
                          ${Math.round(m.spend).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Math.round(m.reimbursement).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={
                              m.margin >= 0
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400"
                            }
                          >
                            ${Math.round(m.margin).toLocaleString()}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab 4: Rebate Contribution ────────────────────────── */}
        <TabsContent value="rebate-contribution">
          <Card>
            <CardHeader>
              <CardTitle>Per-Surgeon Rebate Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {rebateStats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rebate data available.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Surgeon</TableHead>
                        <TableHead className="text-right">Cases</TableHead>
                        <TableHead className="text-right">Spend</TableHead>
                        <TableHead className="text-right">Est. Rebate (3%)</TableHead>
                        <TableHead className="text-right">Compliance %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rebateStats.map((r) => (
                        <TableRow key={r.name}>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="text-right">{r.cases}</TableCell>
                          <TableCell className="text-right">
                            ${Math.round(r.spend).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-green-600 dark:text-green-400">
                            ${Math.round(r.estRebate).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={
                                r.complianceRate >= 80
                                  ? "default"
                                  : r.complianceRate >= 50
                                    ? "secondary"
                                    : "destructive"
                              }
                            >
                              {Math.round(r.complianceRate)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="mt-4 flex items-center gap-4 rounded-lg bg-muted/50 p-4">
                    <div>
                      <p className="text-sm font-medium">Total Estimated Rebate</p>
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                        ${Math.round(rebateStats.reduce((s, r) => s + r.estRebate, 0)).toLocaleString()}
                      </p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-sm text-muted-foreground">Across {rebateStats.length} surgeons</p>
                      <p className="text-sm text-muted-foreground">
                        Avg compliance:{" "}
                        {rebateStats.length > 0
                          ? Math.round(
                              rebateStats.reduce((s, r) => s + r.complianceRate, 0) /
                                rebateStats.length
                            )
                          : 0}
                        %
                      </p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  )
}
