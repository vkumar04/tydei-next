"use client"

import { useState, useMemo } from "react"
import {
  FileText,
  Building2,
  Percent,
  DollarSign,
  Target,
  Calendar,
  Download,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from "recharts"
import { MetricCard } from "@/components/shared/cards/metric-card"
import { PerformanceRadar } from "./performance-radar"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { VendorPerformanceData } from "@/lib/actions/vendor-analytics"

// Inline demo data matching v0 prototype structure
const contractPerformance = [
  {
    id: "1",
    name: "FirstHealth Usage Agreement",
    facility: "FirstHealth Regional",
    targetSpend: 500000,
    actualSpend: 450000,
    compliance: 95,
    status: "on-track",
    rebateRate: 5.0,
    rebatePaid: 22500,
    rebateTiers: [
      { tier: "Tier 1", threshold: 300000, current: 450000, rebateRate: 3.0, achieved: true },
      { tier: "Tier 2", threshold: 450000, current: 450000, rebateRate: 5.0, achieved: true },
      { tier: "Tier 3", threshold: 600000, current: 450000, rebateRate: 7.0, achieved: false },
    ],
  },
  {
    id: "2",
    name: "Memorial Hospital Supply",
    facility: "Memorial Hospital",
    targetSpend: 400000,
    actualSpend: 380000,
    compliance: 102,
    status: "exceeding",
    rebateRate: 4.0,
    rebatePaid: 15200,
    rebateTiers: [
      { tier: "Tier 1", threshold: 200000, current: 380000, rebateRate: 2.5, achieved: true },
      { tier: "Tier 2", threshold: 350000, current: 380000, rebateRate: 4.0, achieved: true },
      { tier: "Tier 3", threshold: 500000, current: 380000, rebateRate: 5.5, achieved: false },
    ],
  },
  {
    id: "3",
    name: "Clearwater Biologics",
    facility: "Clearwater Medical",
    targetSpend: 600000,
    actualSpend: 520000,
    compliance: 85,
    status: "at-risk",
    rebateRate: 6.0,
    rebatePaid: 31200,
    rebateTiers: [
      { tier: "Tier 1", threshold: 400000, current: 520000, rebateRate: 4.0, achieved: true },
      { tier: "Tier 2", threshold: 550000, current: 520000, rebateRate: 6.0, achieved: false },
      { tier: "Tier 3", threshold: 700000, current: 520000, rebateRate: 8.0, achieved: false },
    ],
  },
  {
    id: "4",
    name: "Regional Medical Center",
    facility: "Regional Medical",
    targetSpend: 300000,
    actualSpend: 280000,
    compliance: 98,
    status: "on-track",
    rebateRate: 3.5,
    rebatePaid: 9800,
    rebateTiers: [
      { tier: "Tier 1", threshold: 150000, current: 280000, rebateRate: 2.0, achieved: true },
      { tier: "Tier 2", threshold: 250000, current: 280000, rebateRate: 3.5, achieved: true },
      { tier: "Tier 3", threshold: 350000, current: 280000, rebateRate: 5.0, achieved: false },
    ],
  },
  {
    id: "5",
    name: "University Health System",
    facility: "University Hospital",
    targetSpend: 750000,
    actualSpend: 680000,
    compliance: 92,
    status: "on-track",
    rebateRate: 5.5,
    rebatePaid: 37400,
    rebateTiers: [
      { tier: "Tier 1", threshold: 500000, current: 680000, rebateRate: 3.5, achieved: true },
      { tier: "Tier 2", threshold: 650000, current: 680000, rebateRate: 5.5, achieved: true },
      { tier: "Tier 3", threshold: 850000, current: 680000, rebateRate: 7.5, achieved: false },
    ],
  },
]

const monthlyTrend = [
  { month: "Jan", spend: 320000, target: 350000, rebates: 16000 },
  { month: "Feb", spend: 285000, target: 300000, rebates: 14250 },
  { month: "Mar", spend: 340000, target: 320000, rebates: 17000 },
  { month: "Apr", spend: 298000, target: 310000, rebates: 14900 },
  { month: "May", spend: 375000, target: 340000, rebates: 18750 },
  { month: "Jun", spend: 410000, target: 380000, rebates: 20500 },
  { month: "Jul", spend: 385000, target: 390000, rebates: 19250 },
  { month: "Aug", spend: 420000, target: 400000, rebates: 21000 },
]

const categoryBreakdown = [
  { category: "Biologics", spend: 580000, target: 620000, pct: 93.5 },
  { category: "Disposables", spend: 320000, target: 300000, pct: 106.7 },
  { category: "Instruments", spend: 180000, target: 200000, pct: 90.0 },
  { category: "Implants", spend: 420000, target: 450000, pct: 93.3 },
  { category: "Equipment", spend: 150000, target: 180000, pct: 83.3 },
]

const defaultRebateTierProgress = [
  { tier: "Tier 1", threshold: 1000000, current: 2310000, rebateRate: 3.0, achieved: true },
  { tier: "Tier 2", threshold: 2000000, current: 2310000, rebateRate: 4.5, achieved: true },
  { tier: "Tier 3", threshold: 3500000, current: 2310000, rebateRate: 6.0, achieved: false },
]

interface PerformanceDashboardProps {
  data: VendorPerformanceData
}

export function PerformanceDashboard({ data }: PerformanceDashboardProps) {
  const [rebateContractFilter, setRebateContractFilter] = useState("all")
  const [rebateFacilityFilter, setRebateFacilityFilter] = useState("all")

  const uniqueFacilities = Array.from(new Set(contractPerformance.map((c) => c.facility)))

  const filteredContracts = contractPerformance.filter((c) => {
    if (rebateContractFilter !== "all" && c.id !== rebateContractFilter) return false
    if (rebateFacilityFilter !== "all" && c.facility !== rebateFacilityFilter) return false
    return true
  })

  const displayedRebateTiers = useMemo(() => {
    if (rebateContractFilter !== "all") {
      const contract = contractPerformance.find((c) => c.id === rebateContractFilter)
      return contract?.rebateTiers ?? defaultRebateTierProgress
    }
    if (rebateFacilityFilter !== "all") {
      const facilityContracts = contractPerformance.filter(
        (c) => c.facility === rebateFacilityFilter
      )
      if (facilityContracts.length === 1) return facilityContracts[0].rebateTiers
      const totalSpend = facilityContracts.reduce((s, c) => s + c.actualSpend, 0)
      return [
        { tier: "Tier 1", threshold: 500000, current: totalSpend, rebateRate: 3.0, achieved: totalSpend >= 500000 },
        { tier: "Tier 2", threshold: 1000000, current: totalSpend, rebateRate: 4.5, achieved: totalSpend >= 1000000 },
        { tier: "Tier 3", threshold: 1500000, current: totalSpend, rebateRate: 6.0, achieved: totalSpend >= 1500000 },
      ]
    }
    return defaultRebateTierProgress
  }, [rebateContractFilter, rebateFacilityFilter])

  const totalTargetSpend = contractPerformance.reduce((s, c) => s + c.targetSpend, 0)
  const totalActualSpend = contractPerformance.reduce((s, c) => s + c.actualSpend, 0)
  const totalRebatesPaid = contractPerformance.reduce((s, c) => s + c.rebatePaid, 0)
  const avgCompliance =
    contractPerformance.reduce((s, c) => s + c.compliance, 0) / contractPerformance.length
  const contractsAtRisk = contractPerformance.filter((c) => c.status === "at-risk").length
  const contractsExceeding = contractPerformance.filter((c) => c.status === "exceeding").length

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Spend</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalActualSpend)}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <span>Target: {formatCurrency(totalTargetSpend)}</span>
              <Badge
                variant={totalActualSpend >= totalTargetSpend * 0.9 ? "default" : "secondary"}
              >
                {((totalActualSpend / totalTargetSpend) * 100).toFixed(0)}%
              </Badge>
            </div>
            <Progress
              value={(totalActualSpend / totalTargetSpend) * 100}
              className="h-1.5 mt-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Rebates Paid</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRebatesPaid)}</div>
            <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 mt-1">
              <ArrowUpRight className="h-3 w-3" />
              <span>+12% from last period</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Compliance</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgCompliance.toFixed(1)}%</div>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-green-600 dark:text-green-400">
                {contractsExceeding} exceeding
              </Badge>
              <Badge variant="outline" className="text-yellow-600 dark:text-yellow-400">
                {contractsAtRisk} at risk
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Contracts</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.contractCount || contractPerformance.length}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Across {data.activeFacilities || uniqueFacilities.length} facilities
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contracts">By Contract</TabsTrigger>
          <TabsTrigger value="rebates">Rebate Progress</TabsTrigger>
          <TabsTrigger value="categories">By Category</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Spend vs Target Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Spend vs Target Trend</CardTitle>
                <CardDescription>Monthly performance against targets</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                        axisLine={{ stroke: "hsl(var(--border))" }}
                        tickLine={{ stroke: "hsl(var(--border))" }}
                      />
                      <YAxis
                        tickFormatter={(v: number) => formatCurrency(v)}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                        axisLine={{ stroke: "hsl(var(--border))" }}
                        tickLine={{ stroke: "hsl(var(--border))" }}
                      />
                      <Tooltip
                        formatter={(v) => formatCurrency(Number(v))}
                        contentStyle={chartTooltipStyle}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="target"
                        stroke="#94a3b8"
                        fill="#94a3b8"
                        fillOpacity={0.2}
                        strokeDasharray="5 5"
                        name="Target"
                      />
                      <Area
                        type="monotone"
                        dataKey="spend"
                        stroke="#3b82f6"
                        fill="#3b82f6"
                        fillOpacity={0.3}
                        name="Actual Spend"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Performance Radar */}
            <PerformanceRadar
              scores={{
                compliance: data.compliance,
                delivery: data.delivery,
                quality: data.quality,
                pricing: data.pricing,
              }}
            />
          </div>

          {/* Monthly Rebates */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly Rebates Paid</CardTitle>
              <CardDescription>Rebate payments over time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                      tickLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatCurrency(v)}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                      tickLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <Tooltip
                      formatter={(v) => formatCurrency(Number(v))}
                      contentStyle={chartTooltipStyle}
                    />
                    <Bar dataKey="rebates" fill="#22c55e" radius={[4, 4, 0, 0]} name="Rebates" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* By Contract Tab */}
        <TabsContent value="contracts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contract Performance Details</CardTitle>
              <CardDescription>Individual contract compliance and metrics</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract</TableHead>
                    <TableHead>Facility</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Compliance</TableHead>
                    <TableHead className="text-right">Rebate Paid</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contractPerformance.map((contract) => (
                    <TableRow key={contract.id}>
                      <TableCell className="font-medium">{contract.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {contract.facility}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(contract.targetSpend)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(contract.actualSpend)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Progress value={contract.compliance} className="w-16 h-2" />
                          <span className="text-sm">{contract.compliance}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-green-600 dark:text-green-400">
                        {formatCurrency(contract.rebatePaid)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            contract.status === "exceeding"
                              ? "default"
                              : contract.status === "on-track"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {contract.status === "exceeding" && (
                            <ArrowUpRight className="h-3 w-3 mr-1" />
                          )}
                          {contract.status === "at-risk" && (
                            <AlertTriangle className="h-3 w-3 mr-1" />
                          )}
                          {contract.status === "on-track" && (
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                          )}
                          {contract.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rebate Progress Tab */}
        <TabsContent value="rebates" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Filter by:</span>
                </div>
                <Select value={rebateContractFilter} onValueChange={setRebateContractFilter}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="All Contracts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Contracts</SelectItem>
                    {contractPerformance.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={rebateFacilityFilter} onValueChange={setRebateFacilityFilter}>
                  <SelectTrigger className="w-[200px]">
                    <Building2 className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="All Facilities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Facilities</SelectItem>
                    {uniqueFacilities.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(rebateContractFilter !== "all" || rebateFacilityFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRebateContractFilter("all")
                      setRebateFacilityFilter("all")
                    }}
                  >
                    Clear Filters
                  </Button>
                )}
                <div className="ml-auto text-sm text-muted-foreground">
                  Showing {filteredContracts.length} of {contractPerformance.length} contracts
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Filtered Contract Rebate Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contract Rebate Performance</CardTitle>
              <CardDescription>Rebate progress by individual contract</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract</TableHead>
                    <TableHead>Facility</TableHead>
                    <TableHead className="text-right">Target Spend</TableHead>
                    <TableHead className="text-right">Actual Spend</TableHead>
                    <TableHead className="text-right">Rebate Rate</TableHead>
                    <TableHead className="text-right">Rebate Paid</TableHead>
                    <TableHead className="text-right">Progress</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContracts.map((contract) => (
                    <TableRow key={contract.id}>
                      <TableCell className="font-medium">{contract.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {contract.facility}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(contract.targetSpend)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(contract.actualSpend)}
                      </TableCell>
                      <TableCell className="text-right">{contract.rebateRate}%</TableCell>
                      <TableCell className="text-right text-green-600 dark:text-green-400 font-medium">
                        {formatCurrency(contract.rebatePaid)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Progress value={contract.compliance} className="w-20 h-2" />
                          <span className="text-sm w-12">{contract.compliance}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredContracts.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground py-8"
                      >
                        No contracts match the selected filters
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {filteredContracts.length > 0 && (
                <div className="mt-4 pt-4 border-t grid grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-sm text-muted-foreground">Total Target</div>
                    <div className="font-bold">
                      {formatCurrency(filteredContracts.reduce((s, c) => s + c.targetSpend, 0))}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Total Actual</div>
                    <div className="font-bold">
                      {formatCurrency(filteredContracts.reduce((s, c) => s + c.actualSpend, 0))}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Total Rebates</div>
                    <div className="font-bold text-green-600 dark:text-green-400">
                      {formatCurrency(filteredContracts.reduce((s, c) => s + c.rebatePaid, 0))}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Avg Compliance</div>
                    <div className="font-bold">
                      {(
                        filteredContracts.reduce((s, c) => s + c.compliance, 0) /
                        filteredContracts.length
                      ).toFixed(1)}
                      %
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rebate Tier Progress & Summary */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rebate Tier Progress</CardTitle>
                <CardDescription>
                  {rebateContractFilter !== "all"
                    ? `Progress for ${contractPerformance.find((c) => c.id === rebateContractFilter)?.name}`
                    : rebateFacilityFilter !== "all"
                      ? `Progress for ${rebateFacilityFilter}`
                      : "Aggregated progress across all contracts"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {displayedRebateTiers.map((tier) => (
                  <div key={tier.tier} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{tier.tier}</span>
                        <Badge variant="outline">{tier.rebateRate}% rebate</Badge>
                      </div>
                      {tier.achieved ? (
                        <Badge className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Achieved
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {formatCurrency(tier.threshold - tier.current)} to go
                        </span>
                      )}
                    </div>
                    <Progress
                      value={Math.min((tier.current / tier.threshold) * 100, 100)}
                      className="h-3"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{formatCurrency(tier.current)}</span>
                      <span>{formatCurrency(tier.threshold)}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rebate Summary</CardTitle>
                <CardDescription>Year-to-date rebate performance</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {formatCurrency(totalRebatesPaid)}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Paid YTD</div>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-bold">
                      {((totalRebatesPaid / totalActualSpend) * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm text-muted-foreground">Effective Rate</div>
                  </div>
                </div>
                <div className="rounded-lg bg-muted/50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="h-4 w-4 text-primary" />
                    <span className="font-medium">Next Tier Goal</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Achieve {formatCurrency(3500000)} in total spend to unlock Tier 3 (6.0% rebate
                    rate). You are {formatCurrency(3500000 - totalActualSpend)} away from this
                    target.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* By Category Tab */}
        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance by Category</CardTitle>
              <CardDescription>
                Spend and compliance breakdown by product category
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] mb-6">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatCurrency(v)}
                      tick={{ fill: "hsl(var(--muted-foreground))" }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                      tickLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="category"
                      width={100}
                      tick={{ fill: "hsl(var(--foreground))" }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                      tickLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <Tooltip
                      formatter={(v) => formatCurrency(Number(v))}
                      contentStyle={chartTooltipStyle}
                    />
                    <Legend />
                    <Bar
                      dataKey="target"
                      fill="#94a3b8"
                      name="Target"
                      radius={[0, 4, 4, 0]}
                    />
                    <Bar
                      dataKey="spend"
                      fill="#3b82f6"
                      name="Actual"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">% of Target</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryBreakdown.map((cat) => (
                    <TableRow key={cat.category}>
                      <TableCell className="font-medium">{cat.category}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cat.target)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cat.spend)}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            cat.pct >= 100
                              ? "text-green-600 dark:text-green-400"
                              : cat.pct >= 90
                                ? ""
                                : "text-yellow-600 dark:text-yellow-400"
                          }
                        >
                          {cat.pct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        {cat.pct >= 100 ? (
                          <Badge className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">Exceeding</Badge>
                        ) : cat.pct >= 90 ? (
                          <Badge variant="secondary">On Track</Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600">
                            Below Target
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
