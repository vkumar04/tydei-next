"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
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
import { Label } from "@/components/ui/label"
import { CostDistributionChart } from "@/components/facility/case-costing/cost-distribution-chart"
import {
  useCaseCostingReport,
  useCases,
  useTrueMarginReport,
} from "@/hooks/use-case-costing"
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
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Download,
  Filter,
  Printer,
  Mail,
  Stethoscope,
  DollarSign,
  Target,
  User,
  Activity,
  BarChart3,
  Sparkles,
} from "lucide-react"

interface CaseCostingReportsClientProps {
  facilityId: string
}

type ReportTab =
  | "surgeon-comparison"
  | "procedure-analysis"
  | "cost-trends"
  | "rebate-contribution"
  | "true-margin"

type DateRange =
  | "1month"
  | "3months"
  | "6months"
  | "12months"
  | "24months"
  | "36months"
  | "60months"
  | "ytd"
  | "all"

function getDateFrom(range: DateRange): string | undefined {
  if (range === "all") return undefined
  const d = new Date()
  if (range === "1month") d.setMonth(d.getMonth() - 1)
  else if (range === "3months") d.setMonth(d.getMonth() - 3)
  else if (range === "6months") d.setMonth(d.getMonth() - 6)
  else if (range === "12months") d.setFullYear(d.getFullYear() - 1)
  else if (range === "24months") d.setFullYear(d.getFullYear() - 2)
  else if (range === "36months") d.setFullYear(d.getFullYear() - 3)
  else if (range === "60months") d.setFullYear(d.getFullYear() - 5)
  else if (range === "ytd") {
    d.setMonth(0)
    d.setDate(1)
  }
  return d.toISOString().slice(0, 10)
}

export function CaseCostingReportsClient({ facilityId }: CaseCostingReportsClientProps) {
  const [dateRange, setDateRange] = useState<DateRange>("12months")
  const [selectedSurgeon, setSelectedSurgeon] = useState<string>("all")
  const [selectedProcedure, setSelectedProcedure] = useState<string>("all")
  const [activeTab, setActiveTab] = useState<ReportTab>("surgeon-comparison")

  const dateFrom = getDateFrom(dateRange)
  const todayIso = new Date().toISOString().slice(0, 10)
  // True-margin needs an explicit window. When the user picks
  // "All Time" we still need a lower bound — fall back to a wide
  // 5-year window so stale rebates don't get pulled into the
  // attribution. Period start defaults to dateFrom, end is today.
  const trueMarginPeriodStart =
    dateFrom ??
    (() => {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 5)
      return d.toISOString().slice(0, 10)
    })()

  const { data: report, isLoading } = useCaseCostingReport(facilityId)
  const { data: casesData } = useCases(facilityId, {
    pageSize: 500,
    ...(dateFrom ? { dateFrom } : {}),
  })
  const { data: trueMargin, isLoading: trueMarginLoading } =
    useTrueMarginReport(facilityId, trueMarginPeriodStart, todayIso)

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

  const surgeonOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of cases) if (c.surgeonName) set.add(c.surgeonName)
    return Array.from(set)
  }, [cases])

  const procedureOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of cases) if (c.primaryCptCode) set.add(c.primaryCptCode)
    return Array.from(set)
  }, [cases])

  const totalRebates = useMemo(
    () => rebateStats.reduce((s, r) => s + r.estRebate, 0),
    [rebateStats]
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/case-costing">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Case Costing Reports
            </h1>
            <p className="text-muted-foreground">
              Surgeon performance, procedure analytics, and cost analysis
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm">
            <Mail className="mr-2 h-4 w-4" />
            Email
          </Button>
          <Button size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Report Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as ReportTab)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="surgeon-comparison">
                    Surgeon Comparison
                  </SelectItem>
                  <SelectItem value="procedure-analysis">
                    Procedure Analysis
                  </SelectItem>
                  <SelectItem value="cost-trends">Cost Trends</SelectItem>
                  <SelectItem value="rebate-contribution">
                    Rebate Contribution
                  </SelectItem>
                  <SelectItem value="true-margin">True Margin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Surgeon</Label>
              <Select
                value={selectedSurgeon}
                onValueChange={setSelectedSurgeon}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Surgeons</SelectItem>
                  {surgeonOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Procedure</Label>
              <Select
                value={selectedProcedure}
                onValueChange={setSelectedProcedure}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Procedures</SelectItem>
                  {procedureOptions.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date Range</Label>
              <Select
                value={dateRange}
                onValueChange={(v) => setDateRange(v as DateRange)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1month">Last Month</SelectItem>
                  <SelectItem value="3months">Last 3 Months</SelectItem>
                  <SelectItem value="6months">Last 6 Months</SelectItem>
                  <SelectItem value="12months">Last 12 Months</SelectItem>
                  <SelectItem value="24months">Last 2 Years</SelectItem>
                  <SelectItem value="36months">Last 3 Years</SelectItem>
                  <SelectItem value="60months">Last 5 Years</SelectItem>
                  <SelectItem value="ytd">Year to Date</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cases</CardTitle>
            <Stethoscope className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {report.totalCases.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {cases.length} in selected range
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Rebates</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${Math.round(totalRebates).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Estimated @ 3%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Margin</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${Math.round(report.avgMargin).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Per case</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Contract Compliance
            </CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Math.round(report.complianceRate)}%
            </div>
            <p className="text-xs text-muted-foreground">Across all surgeons</p>
          </CardContent>
        </Card>
      </div>

      {/* Cost Distribution Chart */}
      <CostDistributionChart cases={cases} />

      {/* Report Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ReportTab)}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="surgeon-comparison" className="gap-2">
            <User className="h-4 w-4" />
            Surgeon Comparison
          </TabsTrigger>
          <TabsTrigger value="procedure-analysis" className="gap-2">
            <Activity className="h-4 w-4" />
            Procedure Analysis
          </TabsTrigger>
          <TabsTrigger value="cost-trends" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Cost Trends
          </TabsTrigger>
          <TabsTrigger value="rebate-contribution" className="gap-2">
            <DollarSign className="h-4 w-4" />
            Rebate Contribution
          </TabsTrigger>
          <TabsTrigger value="true-margin" className="gap-2">
            <Sparkles className="h-4 w-4" />
            True Margin
          </TabsTrigger>
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

        {/* ─── Tab 5: True Margin ────────────────────────────────── */}
        <TabsContent value="true-margin" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>True Margin (per procedure)</CardTitle>
              <p className="text-sm text-muted-foreground">
                Per-procedure margin with proportional rebate
                allocation. Rebates are split across procedures by each
                vendor&apos;s spend share, sourced through the canonical
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
                  allocateRebatesToProcedures
                </code>
                helper. Window: {trueMarginPeriodStart} → {todayIso}.
              </p>
            </CardHeader>
            <CardContent>
              {trueMarginLoading ? (
                <Skeleton className="h-[300px] rounded-xl" />
              ) : !trueMargin ? (
                <p className="text-sm text-muted-foreground">
                  No true-margin data available.
                </p>
              ) : trueMargin.procedures.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No cases in the selected window.
                </p>
              ) : (
                <>
                  {/* Aggregate summary row */}
                  <div className="mb-4 grid gap-4 sm:grid-cols-3">
                    <div className="rounded-lg border bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">
                        Standard Margin
                      </p>
                      <p className="text-xl font-bold">
                        $
                        {Math.round(
                          trueMargin.summary.standardMargin,
                        ).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {trueMargin.summary.standardMarginPercent != null
                          ? `${trueMargin.summary.standardMarginPercent.toFixed(1)}%`
                          : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-green-50 p-3 dark:bg-green-950/30">
                      <p className="text-xs text-muted-foreground">
                        True Margin (with rebates)
                      </p>
                      <p className="text-xl font-bold text-green-700 dark:text-green-400">
                        $
                        {Math.round(
                          trueMargin.summary.trueMargin,
                        ).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {trueMargin.summary.trueMarginPercent != null
                          ? `${trueMargin.summary.trueMarginPercent.toFixed(1)}%`
                          : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">
                        Rebate Allocation
                      </p>
                      <p className="text-xl font-bold text-green-700 dark:text-green-400">
                        +$
                        {Math.round(
                          trueMargin.summary.totalRebateAllocation,
                        ).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {trueMargin.summary.marginImprovementPercent != null
                          ? `+${trueMargin.summary.marginImprovementPercent.toFixed(2)} pp`
                          : "—"}
                      </p>
                    </div>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Procedure</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">
                          Direct Cost
                        </TableHead>
                        <TableHead className="text-right">
                          Rebate Allocation
                        </TableHead>
                        <TableHead className="text-right">
                          Effective Cost
                        </TableHead>
                        <TableHead className="text-right">Standard %</TableHead>
                        <TableHead className="text-right">True %</TableHead>
                        <TableHead className="text-right">
                          Improvement
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trueMargin.procedures.map((p) => (
                        <TableRow key={p.procedureId}>
                          <TableCell className="font-medium">
                            <div>{p.procedureName}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.caseNumber}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            ${Math.round(p.totalRevenue).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            ${Math.round(p.directCost).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-green-700 dark:text-green-400">
                            +${Math.round(p.rebateAllocation).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            ${Math.round(p.effectiveCost).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {p.standardMarginPercent != null
                              ? `${p.standardMarginPercent.toFixed(1)}%`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={
                                p.trueMarginPercent != null &&
                                p.trueMarginPercent >= 0
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-600 dark:text-red-400"
                              }
                            >
                              {p.trueMarginPercent != null
                                ? `${p.trueMarginPercent.toFixed(1)}%`
                                : "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {p.marginImprovementPercent != null ? (
                              <Badge variant="secondary">
                                +{p.marginImprovementPercent.toFixed(2)} pp
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {trueMargin.vendors.length > 0 && (
                    <div className="mt-6">
                      <h4 className="mb-2 text-sm font-medium">
                        Vendor Roll-up
                      </h4>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Vendor</TableHead>
                            <TableHead className="text-right">
                              Total Spend
                            </TableHead>
                            <TableHead className="text-right">
                              Earned Rebate (window)
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {trueMargin.vendors.map((v) => (
                            <TableRow key={v.vendorId}>
                              <TableCell className="font-medium">
                                {v.vendorName}
                              </TableCell>
                              <TableCell className="text-right">
                                ${Math.round(v.totalSpend).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right text-green-700 dark:text-green-400">
                                +$
                                {Math.round(v.earnedRebate).toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
