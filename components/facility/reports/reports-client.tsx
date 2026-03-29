"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  DollarSign,
  Download,
  TrendingUp,
} from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { DateRangePicker } from "@/components/shared/forms/date-range-picker"
import { ReportPeriodTable } from "./report-period-table"
import { ReportTrendChart } from "./report-trend-chart"
import { ReportExportButton } from "./report-export-button"
import { queryKeys } from "@/lib/query-keys"
import { getReportData, getContracts } from "@/lib/actions/reports"
import { formatCurrency } from "@/lib/formatting"
import type { ContractPeriodRow } from "./report-columns"

/* ─── Constants ───────────────────────────────────────────────── */

const ALL_REPORT_TABS = [
  { label: "Usage", value: "usage" },
  { label: "Service", value: "service" },
  { label: "Capital", value: "capital" },
  { label: "Tie-In", value: "tie_in" },
  { label: "Grouped", value: "grouped" },
  { label: "Overview", value: "overview" },
  { label: "Calculation Audit", value: "calculations" },
] as const

type ReportTab = (typeof ALL_REPORT_TABS)[number]["value"]

const DATA_REPORT_TYPES = ["usage", "service", "capital", "tie_in", "grouped"] as const

function getDefaultRange() {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const from = new Date(now.getFullYear(), q * 3, 1)
  const to = new Date(now.getFullYear(), q * 3 + 3, 0)
  return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] }
}

/* ─── Main Component ──────────────────────────────────────────── */

interface ReportsClientProps {
  facilityId: string
}

export function ReportsClient({ facilityId }: ReportsClientProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>("usage")
  const [dateRange, setDateRange] = useState(getDefaultRange)
  const [metric, setMetric] = useState<"totalSpend" | "rebateEarned" | "totalVolume">("totalSpend")
  const [selectedContractId, setSelectedContractId] = useState("all")

  /* ── Queries ─────────────────────────────────────────────────── */

  // Contract list for the selector dropdown
  const { data: contractsList } = useQuery({
    queryKey: queryKeys.contracts.list(facilityId, { reportSelector: true }),
    queryFn: () => getContracts(facilityId),
  })

  // Determine the server-side report type (overview/calculations reuse "usage" data)
  const serverReportType = useMemo(() => {
    if (activeTab === "overview" || activeTab === "calculations") return "usage"
    return activeTab
  }, [activeTab])

  // Fetch report data
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports.data(facilityId, serverReportType, dateRange),
    queryFn: () =>
      getReportData({
        facilityId,
        reportType: serverReportType as "usage" | "service" | "tie_in" | "capital" | "grouped",
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
      }),
  })

  /* ── Derived State ───────────────────────────────────────────── */

  // Filter periods by selected contract
  const allPeriods: ContractPeriodRow[] = useMemo(() => {
    if (!data?.contracts) return []
    if (selectedContractId === "all") return data.contracts.flatMap((c) => c.periods)
    const match = data.contracts.find((c) => c.id === selectedContractId)
    return match?.periods ?? []
  }, [data, selectedContractId])

  // Selected contract details
  const selectedContract = useMemo(() => {
    if (selectedContractId === "all" || !contractsList) return null
    return contractsList.find((c: { id: string }) => c.id === selectedContractId) ?? null
  }, [contractsList, selectedContractId])

  // Which tabs to show
  const visibleTabs = useMemo(() => {
    if (selectedContractId === "all" || !selectedContract) return ALL_REPORT_TABS
    const ct = (selectedContract as { contractType?: string }).contractType ?? "usage"
    const primary = ALL_REPORT_TABS.find((t) => t.value === ct)
    const overviewTab = ALL_REPORT_TABS.find((t) => t.value === "overview")!
    const calcTab = ALL_REPORT_TABS.find((t) => t.value === "calculations")!
    return primary ? [primary, overviewTab, calcTab] : [ALL_REPORT_TABS[0], overviewTab, calcTab]
  }, [selectedContractId, selectedContract])

  /* ── Handlers ────────────────────────────────────────────────── */

  const handleContractChange = (contractId: string) => {
    setSelectedContractId(contractId)
    if (contractId !== "all" && contractsList) {
      const contract = contractsList.find((c: { id: string }) => c.id === contractId)
      if (contract) {
        const typeMap: Record<string, ReportTab> = {
          usage: "usage",
          capital: "capital",
          service: "service",
          tie_in: "tie_in",
          grouped: "grouped",
        }
        const mapped = typeMap[(contract as { contractType: string }).contractType]
        if (mapped) setActiveTab(mapped)
      }
    }
  }

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Reports"
        description="Contract performance reports with scheduled delivery"
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <Clock className="h-4 w-4" />
              Schedule Report
            </Button>
            <ReportExportButton
              facilityId={facilityId}
              reportType={serverReportType}
              dateFrom={dateRange.from}
              dateTo={dateRange.to}
            />
          </div>
        }
      />

      {/* Quick Access Report Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/dashboard/reports/price-discrepancy">
          <Card className="cursor-pointer transition-colors hover:bg-accent/50 border-red-200 dark:border-red-900">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                  Action Required
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <h3 className="font-semibold">Price Discrepancy Report</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Identify pricing variances between contracts and actual purchases
              </p>
              <div className="flex items-center gap-1 mt-3 text-sm text-red-600 font-medium">
                View Report <ArrowRight className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/analysis">
          <Card className="cursor-pointer transition-colors hover:bg-accent/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <TrendingUp className="h-5 w-5 text-primary" />
                <Badge variant="outline">Analysis</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <h3 className="font-semibold">Contract Analysis</h3>
              <p className="text-sm text-muted-foreground mt-1">
                NPV, IRR, and prospective contract evaluation
              </p>
              <div className="flex items-center gap-1 mt-3 text-sm text-primary font-medium">
                View Analysis <ArrowRight className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/case-costing">
          <Card className="cursor-pointer transition-colors hover:bg-accent/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <DollarSign className="h-5 w-5 text-primary" />
                <Badge variant="outline">Performance</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <h3 className="font-semibold">Surgeon Scorecard</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Performance metrics and margin analysis by surgeon
              </p>
              <div className="flex items-center gap-1 mt-3 text-sm text-primary font-medium">
                View Scorecard <ArrowRight className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Filters Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <Select value={selectedContractId} onValueChange={handleContractChange}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="All Contracts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Contracts</SelectItem>
                {contractsList?.map(
                  (c: { id: string; name: string; contractType: string }) => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <span>{c.name}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          {c.contractType}
                        </Badge>
                      </div>
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
          </div>

          {/* Selected contract details banner */}
          {selectedContract && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Selected Contract:</span>
                  <span className="font-medium">
                    {(selectedContract as { name: string }).name}
                  </span>
                </div>
                <Badge variant="default">
                  {(selectedContract as { status?: string }).status ?? "active"}
                </Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Report Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReportTab)}>
        <TabsList className="h-auto flex-wrap gap-1 p-1">
          {visibleTabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="px-4 py-2">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Data-driven tabs: Usage, Service, Capital, Tie-In, Grouped */}
        {DATA_REPORT_TYPES.map((tab) => (
          <TabsContent key={tab} value={tab} className="space-y-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-[300px] rounded-xl" />
                <Skeleton className="h-[400px] rounded-xl" />
              </div>
            ) : (
              <Card>
                <CardHeader className="bg-muted/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>
                        {tab === "usage" && "Contract Performance Details"}
                        {tab === "service" && "Service Contract Performance"}
                        {tab === "capital" && "Capital Contract Performance"}
                        {tab === "tie_in" && "Tie-In Contract Performance"}
                        {tab === "grouped" && "Grouped Contract Report"}
                      </CardTitle>
                      <CardDescription>
                        From {dateRange.from} To {dateRange.to}
                      </CardDescription>
                    </div>
                    <Badge
                      variant={
                        tab === "usage"
                          ? "default"
                          : tab === "service"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {tab === "usage" && "Usage Contract"}
                      {tab === "service" && "Service Contract"}
                      {tab === "capital" && "Capital Contract"}
                      {tab === "tie_in" && "Tie-In Contract"}
                      {tab === "grouped" && "Grouped Contract"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-6">
                  {/* Metric selector */}
                  <div className="flex items-center gap-2">
                    {(["totalSpend", "rebateEarned", "totalVolume"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMetric(m)}
                        className={`rounded-md px-3 py-1 text-sm ${
                          metric === m
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {m === "totalSpend"
                          ? "Spend"
                          : m === "rebateEarned"
                          ? "Rebate"
                          : "Volume"}
                      </button>
                    ))}
                  </div>

                  {/* Chart */}
                  <ReportTrendChart data={allPeriods} metric={metric} reportType={tab} />

                  {/* Table */}
                  <ReportPeriodTable periods={allPeriods} reportType={tab} />
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : (
            <OverviewTab
              data={data}
              allPeriods={allPeriods}
              selectedContract={selectedContract}
              dateRange={dateRange}
            />
          )}
        </TabsContent>

        {/* Calculation Audit Tab */}
        <TabsContent value="calculations" className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : (
            <CalculationAuditTab data={data} allPeriods={allPeriods} dateRange={dateRange} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ─── Overview Sub-Component ──────────────────────────────────── */

interface ContractSummary {
  id: string
  name: string
  vendor: string
  contractType: string
  periods: ContractPeriodRow[]
}

function OverviewTab({
  data,
  allPeriods,
  selectedContract,
  dateRange,
}: {
  data: { contracts: ContractSummary[] } | undefined
  allPeriods: ContractPeriodRow[]
  selectedContract: unknown
  dateRange: { from: string; to: string }
}) {
  const totalSpend = allPeriods.reduce((s, p) => s + p.totalSpend, 0)
  const totalRebate = allPeriods.reduce((s, p) => s + p.rebateEarned, 0)
  const contractCount = data?.contracts.length ?? 0

  if (selectedContract) {
    const c = selectedContract as { name?: string; contractType?: string; status?: string }
    return (
      <>
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
                className="text-green-600"
              />
              <MetricCard label="Periods" value={String(allPeriods.length)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Key Contract Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="p-4 rounded-lg border">
                <p className="text-sm text-muted-foreground mb-1">Rebate Rate</p>
                <p className="text-2xl font-bold text-green-600">
                  {totalSpend > 0
                    ? `${((totalRebate / totalSpend) * 100).toFixed(1)}%`
                    : "0%"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Rebate as % of spend</p>
              </div>
              <div className="p-4 rounded-lg border">
                <p className="text-sm text-muted-foreground mb-1">Avg Period Spend</p>
                <p className="text-2xl font-bold">
                  {allPeriods.length > 0
                    ? formatCurrency(Math.round(totalSpend / allPeriods.length))
                    : "$0"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Based on {allPeriods.length} periods
                </p>
              </div>
              <div className="p-4 rounded-lg border">
                <p className="text-sm text-muted-foreground mb-1">Total Volume</p>
                <p className="text-2xl font-bold">
                  {allPeriods.reduce((s, p) => s + p.totalVolume, 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Units across all periods</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </>
    )
  }

  // All-contracts overview
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Summary</CardTitle>
          <CardDescription>
            {dateRange.from} to {dateRange.to}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-2">
            <MetricCard label="Active Contracts" value={String(contractCount)} />
            <MetricCard label="Combined Spend" value={formatCurrency(totalSpend)} />
            <MetricCard
              label="Total Rebates"
              value={formatCurrency(totalRebate)}
              className="text-green-600"
            />
            <MetricCard
              label="Total Volume"
              value={allPeriods.reduce((s, p) => s + p.totalVolume, 0).toLocaleString()}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spend vs. Rebate by Contract</CardTitle>
        </CardHeader>
        <CardContent>
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
                    <span className="text-green-600">{formatCurrency(rebate)}</span>
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
        </CardContent>
      </Card>
    </div>
  )
}

/* ─── Calculation Audit Sub-Component ─────────────────────────── */

function CalculationAuditTab({
  data,
  allPeriods,
  dateRange,
}: {
  data: { contracts: ContractSummary[] } | undefined
  allPeriods: ContractPeriodRow[]
  dateRange: { from: string; to: string }
}) {
  const totalSpend = allPeriods.reduce((s, p) => s + p.totalSpend, 0)
  const totalRebateEarned = allPeriods.reduce((s, p) => s + p.rebateEarned, 0)
  const totalRebateCollected = allPeriods.reduce((s, p) => s + p.rebateCollected, 0)
  const totalPaymentExpected = allPeriods.reduce((s, p) => s + p.paymentExpected, 0)
  const totalPaymentActual = allPeriods.reduce((s, p) => s + p.paymentActual, 0)

  return (
    <>
      {/* Audit header */}
      <Card>
        <CardHeader className="bg-muted/50">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Calculation Audit Report</CardTitle>
              <CardDescription>
                Complete breakdown of rebates and payments for {dateRange.from} to{" "}
                {dateRange.to}
              </CardDescription>
            </div>
            <Badge variant="outline">{data?.contracts.length ?? 0} contracts</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
            <p className="text-sm text-muted-foreground">
              This report shows a summary of how your contract calculations are derived.
              All calculations are traceable to source period data.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Summary metrics */}
      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label="Total Eligible Spend" value={formatCurrency(totalSpend)} />
        <MetricCard
          label="Rebate Earned"
          value={formatCurrency(totalRebateEarned)}
          className="text-green-600"
        />
        <MetricCard
          label="Rebate Collected"
          value={formatCurrency(totalRebateCollected)}
          className="text-blue-600"
        />
        <MetricCard label="Payment Expected" value={formatCurrency(totalPaymentExpected)} />
        <MetricCard label="Payment Actual" value={formatCurrency(totalPaymentActual)} />
      </div>

      {/* Per-contract breakdown */}
      {data?.contracts.map((c) => {
        const cSpend = c.periods.reduce((s, p) => s + p.totalSpend, 0)
        const cRebEarned = c.periods.reduce((s, p) => s + p.rebateEarned, 0)
        const cRebCollected = c.periods.reduce((s, p) => s + p.rebateCollected, 0)
        return (
          <Card key={c.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">{c.name}</CardTitle>
                  <CardDescription>
                    {c.vendor} &mdash; {c.contractType}
                  </CardDescription>
                </div>
                <Badge variant="outline">{c.periods.length} periods</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-4">
                <div className="p-3 rounded-lg bg-muted/50 text-sm">
                  <span className="text-muted-foreground">Total Spend</span>
                  <p className="font-bold text-lg">{formatCurrency(cSpend)}</p>
                </div>
                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 text-sm">
                  <span className="text-muted-foreground">Rebate Earned</span>
                  <p className="font-bold text-lg text-green-600">
                    {formatCurrency(cRebEarned)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 text-sm">
                  <span className="text-muted-foreground">Rebate Collected</span>
                  <p className="font-bold text-lg text-blue-600">
                    {formatCurrency(cRebCollected)}
                  </p>
                </div>
              </div>

              {/* Period rows */}
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">#</th>
                      <th className="px-4 py-3 text-left font-medium">Period</th>
                      <th className="px-4 py-3 text-right font-medium">Spend</th>
                      <th className="px-4 py-3 text-right font-medium">Rebate Earned</th>
                      <th className="px-4 py-3 text-right font-medium">Rebate Collected</th>
                      <th className="px-4 py-3 text-right font-medium">Payment Exp.</th>
                      <th className="px-4 py-3 text-right font-medium">Payment Act.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.periods.map((p, i) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-4 py-3">{i + 1}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {p.periodStart.split("T")[0]} &ndash;{" "}
                          {p.periodEnd.split("T")[0]}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(p.totalSpend)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(p.rebateEarned)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(p.rebateCollected)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(p.paymentExpected)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(p.paymentActual)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-primary text-primary-foreground">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 font-medium">
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(cSpend)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(cRebEarned)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(cRebCollected)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(
                          c.periods.reduce((s, p) => s + p.paymentExpected, 0)
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(
                          c.periods.reduce((s, p) => s + p.paymentActual, 0)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </>
  )
}

/* ─── Shared Metric Card ──────────────────────────────────────── */

function MetricCard({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className="p-4 rounded-lg border bg-muted/50">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${className ?? ""}`}>{value}</p>
    </div>
  )
}
