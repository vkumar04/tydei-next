"use client"

import { useState, useMemo, Suspense } from "react"
import { useSearchParams } from "next/navigation"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Info,
  ArrowRightLeft,
  Calculator,
  AlertTriangle,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts"
import { useCases } from "@/hooks/use-case-costing"

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
]

interface SurgeonAggregate {
  surgeonId: string
  surgeonName: string
  totalCases: number
  avgSpendPerCase: number
  avgMarginPerCase: number
  marginPercent: number
  contractComplianceRate: number
  totalRebates: number
}

interface SurgeonCompareClientProps {
  facilityId: string
}

function CompareSurgeonsContent({ facilityId }: { facilityId: string }) {
  const searchParams = useSearchParams()
  const { data: casesData, isLoading } = useCases(facilityId, {
    pageSize: 1000,
  })
  const cases = casesData?.cases ?? []

  const [selectedProcedure, setSelectedProcedure] = useState(
    searchParams.get("procedure") ?? ""
  )
  const [selectedSurgeons, setSelectedSurgeons] = useState<string[]>(
    searchParams.get("surgeon") ? [searchParams.get("surgeon")!] : []
  )

  // Unique procedures
  const uniqueProcedures = useMemo(() => {
    const codes = new Set<string>()
    for (const c of cases) {
      if (c.primaryCptCode) codes.add(c.primaryCptCode)
    }
    return Array.from(codes).map((code) => ({ code, description: code }))
  }, [cases])

  // Unique surgeons
  const uniqueSurgeons = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of cases) {
      const name = c.surgeonName ?? "Unknown Surgeon"
      map.set(name, name)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [cases])

  // Aggregate by surgeon for the selected procedure
  const comparisonData = useMemo<SurgeonAggregate[]>(() => {
    if (!selectedProcedure) return []
    const bySurgeon = new Map<
      string,
      {
        totalCases: number
        totalSpend: number
        totalMargin: number
        totalReimbursement: number
        compliantCases: number
      }
    >()
    for (const c of cases) {
      if (c.primaryCptCode !== selectedProcedure) continue
      const key = c.surgeonName ?? "Unknown Surgeon"
      const entry = bySurgeon.get(key) ?? {
        totalCases: 0,
        totalSpend: 0,
        totalMargin: 0,
        totalReimbursement: 0,
        compliantCases: 0,
      }
      entry.totalCases += 1
      entry.totalSpend += c.totalSpend
      entry.totalMargin += c.margin
      entry.totalReimbursement += c.totalReimbursement
      if (c.complianceStatus === "compliant") entry.compliantCases += 1
      bySurgeon.set(key, entry)
    }
    return Array.from(bySurgeon.entries()).map(([name, d]) => {
      const avgSpend = d.totalCases > 0 ? d.totalSpend / d.totalCases : 0
      const avgMargin = d.totalCases > 0 ? d.totalMargin / d.totalCases : 0
      const marginPct =
        d.totalReimbursement > 0
          ? (d.totalMargin / d.totalReimbursement) * 100
          : 0
      const compliancePct =
        d.totalCases > 0 ? (d.compliantCases / d.totalCases) * 100 : 0
      return {
        surgeonId: name,
        surgeonName: name,
        totalCases: d.totalCases,
        avgSpendPerCase: avgSpend,
        avgMarginPerCase: avgMargin,
        marginPercent: marginPct,
        contractComplianceRate: compliancePct,
        totalRebates: 0,
      }
    })
  }, [cases, selectedProcedure])

  // Filter to selected surgeons if any
  const filteredData = useMemo(() => {
    if (selectedSurgeons.length === 0) return comparisonData
    return comparisonData.filter((d) => selectedSurgeons.includes(d.surgeonId))
  }, [comparisonData, selectedSurgeons])

  // Facility benchmark (median of all surgeons for this procedure)
  const benchmark = useMemo(() => {
    if (comparisonData.length === 0) return null
    const sorted = [...comparisonData]
      .map((d) => d.avgSpendPerCase)
      .sort((a, b) => a - b)
    const sum = sorted.reduce((s, v) => s + v, 0)
    const avgSpend = sum / sorted.length
    const avgMargin =
      comparisonData.reduce((s, d) => s + d.avgMarginPerCase, 0) /
      comparisonData.length
    const p25Index = Math.floor(sorted.length * 0.25)
    const p75Index = Math.floor(sorted.length * 0.75)
    return {
      avgSpend,
      avgMargin,
      percentile25: sorted[p25Index] ?? 0,
      percentile75: sorted[p75Index] ?? 0,
    }
  }, [comparisonData])

  const spendChartData = useMemo(() => {
    return filteredData.map((d) => ({
      name: d.surgeonName.replace("Dr. ", ""),
      avgSpend: d.avgSpendPerCase,
      facilityAvg: benchmark?.avgSpend ?? 0,
    }))
  }, [filteredData, benchmark])

  const marginChartData = useMemo(() => {
    return filteredData.map((d) => ({
      name: d.surgeonName.replace("Dr. ", ""),
      avgMargin: d.avgMarginPerCase,
    }))
  }, [filteredData])

  const calculateVendorSwitch = (
    fromSurgeon: SurgeonAggregate,
    toSurgeon: SurgeonAggregate
  ) => {
    const spendDiff = fromSurgeon.avgSpendPerCase - toSurgeon.avgSpendPerCase
    const annualSavings = spendDiff * fromSurgeon.totalCases
    const marginImprovement =
      toSurgeon.marginPercent - fromSurgeon.marginPercent
    return { spendDiff, annualSavings, marginImprovement }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/case-costing">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Surgeon Comparison
          </h1>
          <p className="text-muted-foreground">
            Compare surgeon costs and outcomes by procedure code
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Select Comparison Criteria
          </CardTitle>
          <CardDescription>
            Choose a procedure code and optionally select specific surgeons to
            compare
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="w-[300px]">
              <Label className="text-xs text-muted-foreground">
                Procedure Code *
              </Label>
              <Select
                value={selectedProcedure}
                onValueChange={setSelectedProcedure}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select procedure" />
                </SelectTrigger>
                <SelectContent>
                  {uniqueProcedures.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.code} - {p.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[300px]">
              <Label className="text-xs text-muted-foreground">
                Surgeons (optional)
              </Label>
              <Select
                value={selectedSurgeons[0] ?? "all"}
                onValueChange={(v) =>
                  setSelectedSurgeons(v === "all" ? [] : [v])
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All surgeons" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Surgeons</SelectItem>
                  {uniqueSurgeons.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : !selectedProcedure ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Select a Procedure</AlertTitle>
          <AlertDescription>
            Choose a procedure code above to compare surgeon costs and
            outcomes.
          </AlertDescription>
        </Alert>
      ) : filteredData.length === 0 ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No Data Available</AlertTitle>
          <AlertDescription>
            No case data found for the selected procedure. Upload clinical case
            data to see comparisons.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Benchmark Info */}
          {benchmark && (
            <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Facility Benchmark: {selectedProcedure}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Avg Spend:</span>
                    <span className="ml-2 font-medium">
                      ${Math.round(benchmark.avgSpend).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Avg Margin:</span>
                    <span className="ml-2 font-medium">
                      ${Math.round(benchmark.avgMargin).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      25th Percentile:
                    </span>
                    <span className="ml-2 font-medium">
                      ${Math.round(benchmark.percentile25).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      75th Percentile:
                    </span>
                    <span className="ml-2 font-medium">
                      ${Math.round(benchmark.percentile75).toLocaleString()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Comparison Table */}
          <Card>
            <CardHeader>
              <CardTitle>Surgeon Performance Comparison</CardTitle>
              <CardDescription>
                Average metrics per case for {selectedProcedure}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Surgeon</TableHead>
                    <TableHead className="text-center">Cases</TableHead>
                    <TableHead className="text-right">
                      Avg Spend/Case
                    </TableHead>
                    <TableHead className="text-right">
                      Avg Margin/Case
                    </TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                    <TableHead className="text-right">
                      Contract Compliance
                    </TableHead>
                    <TableHead>vs Benchmark</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((surgeon, idx) => {
                    const aboveBenchmark =
                      benchmark &&
                      surgeon.avgSpendPerCase > benchmark.percentile75
                    const belowBenchmark =
                      benchmark &&
                      surgeon.avgSpendPerCase < benchmark.percentile25

                    return (
                      <TableRow key={surgeon.surgeonId}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{
                                backgroundColor: COLORS[idx % COLORS.length],
                              }}
                            />
                            <span className="font-medium">
                              {surgeon.surgeonName}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {surgeon.totalCases}
                        </TableCell>
                        <TableCell className="text-right">
                          $
                          {Math.round(
                            surgeon.avgSpendPerCase
                          ).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-green-600">
                          $
                          {Math.round(
                            surgeon.avgMarginPerCase
                          ).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {surgeon.marginPercent.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={
                              surgeon.contractComplianceRate >= 90
                                ? "default"
                                : "secondary"
                            }
                          >
                            {surgeon.contractComplianceRate.toFixed(0)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {aboveBenchmark && (
                            <Badge variant="destructive" className="gap-1">
                              <TrendingUp className="h-3 w-3" />
                              Above 75th
                            </Badge>
                          )}
                          {belowBenchmark && (
                            <Badge
                              variant="default"
                              className="gap-1 bg-green-600"
                            >
                              <TrendingDown className="h-3 w-3" />
                              Below 25th
                            </Badge>
                          )}
                          {!aboveBenchmark && !belowBenchmark && benchmark && (
                            <Badge variant="secondary">Average</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Charts */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Average Spend per Case
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={spendChartData} layout="vertical">
                      <CartesianGrid
                        strokeDasharray="3 3"
                        horizontal={true}
                        vertical={false}
                      />
                      <XAxis
                        type="number"
                        tickFormatter={(v) => `$${(v / 1000).toFixed(1)}K`}
                      />
                      <YAxis type="category" dataKey="name" width={100} />
                      <Tooltip
                        formatter={(value) =>
                          `$${Number(value).toLocaleString()}`
                        }
                      />
                      <Legend />
                      <Bar
                        dataKey="avgSpend"
                        name="Surgeon Avg"
                        fill="#3b82f6"
                        radius={[0, 4, 4, 0]}
                      >
                        {spendChartData.map((_, idx) => (
                          <Cell
                            key={idx}
                            fill={COLORS[idx % COLORS.length]}
                          />
                        ))}
                      </Bar>
                      {benchmark && (
                        <Bar
                          dataKey="facilityAvg"
                          name="Facility Avg"
                          fill="#94a3b8"
                          radius={[0, 4, 4, 0]}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Average Margin per Case
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={marginChartData} layout="vertical">
                      <CartesianGrid
                        strokeDasharray="3 3"
                        horizontal={true}
                        vertical={false}
                      />
                      <XAxis
                        type="number"
                        tickFormatter={(v) => `$${(v / 1000).toFixed(1)}K`}
                      />
                      <YAxis type="category" dataKey="name" width={100} />
                      <Tooltip
                        formatter={(value) =>
                          `$${Number(value).toLocaleString()}`
                        }
                      />
                      <Bar
                        dataKey="avgMargin"
                        name="Avg Margin"
                        fill="#10b981"
                        radius={[0, 4, 4, 0]}
                      >
                        {marginChartData.map((_, idx) => (
                          <Cell
                            key={idx}
                            fill={COLORS[idx % COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* What-If Analysis */}
          {filteredData.length >= 2 && (
            <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  What-If Analysis: Vendor Switch Scenario
                </CardTitle>
                <CardDescription>
                  See potential savings if a surgeon switched to a different
                  vendor contract
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {filteredData.slice(0, -1).map((surgeon, idx) => {
                    const nextSurgeon = filteredData[idx + 1]
                    if (!nextSurgeon) return null
                    const scenario = calculateVendorSwitch(
                      surgeon,
                      nextSurgeon
                    )
                    if (scenario.spendDiff <= 0) return null

                    return (
                      <div
                        key={surgeon.surgeonId}
                        className="p-4 rounded-lg border bg-card"
                      >
                        <div className="flex items-center gap-4 mb-3">
                          <Badge variant="outline">
                            {surgeon.surgeonName}
                          </Badge>
                          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                          <Badge variant="outline">
                            {nextSurgeon.surgeonName}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">
                              Spend Reduction/Case:
                            </span>
                            <p className="font-medium text-green-600">
                              $
                              {Math.round(
                                scenario.spendDiff
                              ).toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Annual Savings ({surgeon.totalCases} cases):
                            </span>
                            <p className="font-medium text-green-600">
                              $
                              {Math.round(
                                scenario.annualSavings
                              ).toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Margin Improvement:
                            </span>
                            <p className="font-medium text-green-600">
                              +{scenario.marginImprovement.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

export function SurgeonCompareClient({ facilityId }: SurgeonCompareClientProps) {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="h-8 w-64 animate-pulse bg-muted rounded" />
          <div className="h-96 animate-pulse bg-muted rounded-lg" />
        </div>
      }
    >
      <CompareSurgeonsContent facilityId={facilityId} />
    </Suspense>
  )
}
