"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  usePriceProjections,
  useVendorSpendTrends,
  useCategorySpendTrends,
} from "@/hooks/use-analysis"
import { DepreciationCalculator } from "./depreciation-calculator"
import { DepreciationChart } from "./depreciation-chart"
import { PriceProjectionChart } from "./price-projection-chart"
import { SpendTrendChart } from "./spend-trend-chart"
import type { DepreciationSchedule } from "@/lib/analysis/depreciation"
import Link from "next/link"
import {
  Calculator,
  Target,
  Upload,
  Download,
  DollarSign,
  Percent,
  TrendingUp,
} from "lucide-react"

interface AnalysisClientProps {
  facilityId: string
}

export function AnalysisClient({ facilityId }: AnalysisClientProps) {
  const [schedule, setSchedule] = useState<DepreciationSchedule | null>(null)
  const [analysisType, setAnalysisType] = useState<"capital" | "prospective">(
    "capital"
  )
  const [activeTab, setActiveTab] = useState("upload")

  const dateRange = useMemo(() => {
    const now = new Date()
    const from = new Date(now)
    from.setMonth(now.getMonth() - 6)
    return {
      from: from.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    }
  }, [])

  const { data: projections, isLoading: projLoading } = usePriceProjections(
    facilityId,
    { periods: 12 }
  )
  const { data: vendorTrends, isLoading: vtLoading } = useVendorSpendTrends(
    facilityId,
    dateRange
  )
  const { data: catTrends, isLoading: ctLoading } = useCategorySpendTrends(
    facilityId,
    dateRange
  )

  const totalCapitalValue = useMemo(() => {
    if (!schedule) return 0
    return schedule.assetCost
  }, [schedule])

  const avgDepreciationRate = useMemo(() => {
    if (!schedule || schedule.years.length === 0) return 0
    const totalRate = schedule.years.reduce((s, y) => s + y.rate, 0)
    return Math.round((totalRate / schedule.years.length) * 100) / 100
  }, [schedule])

  const projectedAnnualSpend = useMemo(() => {
    if (!vendorTrends || vendorTrends.length === 0) return 0
    const totalSpend = vendorTrends.reduce((s, t) => s + t.spend, 0)
    const months = new Set(vendorTrends.map((t) => t.month)).size
    if (months === 0) return 0
    return Math.round((totalSpend / months) * 12)
  }, [vendorTrends])

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-balance">
            Contract Analysis
          </h1>
          <p className="text-muted-foreground">
            Evaluate contracts with financial projections, composite scoring, and
            ROI analysis
          </p>
        </div>
      </div>

      {/* Analysis Type Toggle */}
      <div className="flex gap-2">
        <Button
          variant={analysisType === "capital" ? "default" : "outline"}
          className="gap-2"
          onClick={() => setAnalysisType("capital")}
        >
          <Calculator className="h-4 w-4" />
          Capital Contract Analysis
        </Button>
        <Link href={`/f/${facilityId}/analysis/prospective`}>
          <Button
            variant={analysisType === "prospective" ? "default" : "outline"}
            className="gap-2"
            onClick={() => setAnalysisType("prospective")}
          >
            <Target className="h-4 w-4" />
            Prospective Contract Analysis
          </Button>
        </Link>
      </div>

      {analysisType === "capital" && (
        <>
          {/* Capital Analysis Section Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                Capital Contract Analysis
              </h2>
              <p className="text-sm text-muted-foreground">
                Evaluate NPV, IRR, and true cost of capital contracts with
                rebate projections
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Export Report
              </Button>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="space-y-6"
          >
            <TabsList>
              <TabsTrigger value="upload" className="gap-2">
                <Upload className="h-4 w-4" />
                Upload Contract
              </TabsTrigger>
              <TabsTrigger value="inputs">Contract Inputs</TabsTrigger>
              <TabsTrigger value="projections">Yearly Projections</TabsTrigger>
              <TabsTrigger value="analysis">Financial Analysis</TabsTrigger>
              <TabsTrigger value="report">Summary Report</TabsTrigger>
            </TabsList>

            {/* Upload Contract Tab */}
            <TabsContent value="upload" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Upload Capital Contract</CardTitle>
                  <CardDescription>
                    Upload a capital contract PDF to automatically extract and
                    analyze financial terms
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border-2 border-dashed rounded-lg p-8 text-center border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="space-y-3">
                      <div className="flex justify-center">
                        <Upload className="h-10 w-10 text-muted-foreground" />
                      </div>
                      <p className="font-medium">
                        Drag &amp; drop a capital contract PDF
                      </p>
                      <p className="text-sm text-muted-foreground">
                        or click to browse files
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Contract Inputs Tab */}
            <TabsContent value="inputs" className="space-y-6">
              <DepreciationCalculator onScheduleChange={setSchedule} />
            </TabsContent>

            {/* Yearly Projections Tab */}
            <TabsContent value="projections" className="space-y-6">
              {/* Stat Cards */}
              <div className="grid gap-4 sm:grid-cols-3">
                <Card className="border-l-4 border-l-blue-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Total Capital Value
                        </p>
                        <p className="text-2xl font-bold">
                          {schedule
                            ? formatCurrency(totalCapitalValue)
                            : "--"}
                        </p>
                        {schedule && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {schedule.recoveryPeriod}-year MACRS
                          </p>
                        )}
                      </div>
                      <DollarSign className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-amber-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Average Depreciation Rate
                        </p>
                        <p className="text-2xl font-bold">
                          {schedule ? `${avgDepreciationRate}%` : "--"}
                        </p>
                        {schedule && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Per year (
                            {schedule.convention.replace("_", " ")})
                          </p>
                        )}
                      </div>
                      <Percent className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-emerald-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Projected Annual Spend
                        </p>
                        <p className="text-2xl font-bold">
                          {vtLoading
                            ? "--"
                            : formatCurrency(projectedAnnualSpend)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Annualized from trend data
                        </p>
                      </div>
                      <TrendingUp className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {schedule && <DepreciationChart schedule={schedule} />}

              {projLoading ? (
                <Skeleton className="h-[340px] rounded-xl" />
              ) : (
                <PriceProjectionChart projections={projections ?? []} />
              )}
            </TabsContent>

            {/* Financial Analysis Tab */}
            <TabsContent value="analysis" className="space-y-6">
              {vtLoading ? (
                <Skeleton className="h-[380px] rounded-xl" />
              ) : (
                <SpendTrendChart
                  data={vendorTrends ?? []}
                  groupBy="vendor"
                />
              )}

              {ctLoading ? (
                <Skeleton className="h-[380px] rounded-xl" />
              ) : (
                <>
                  <SpendTrendChart
                    data={catTrends ?? []}
                    groupBy="category"
                  />

                  {catTrends && catTrends.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          Category Breakdown
                        </CardTitle>
                        <CardDescription>
                          Spend distribution across product categories
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {(() => {
                            const catTotals = new Map<string, number>()
                            for (const item of catTrends) {
                              const name = item.categoryName ?? "Other"
                              catTotals.set(
                                name,
                                (catTotals.get(name) ?? 0) + item.spend
                              )
                            }
                            const sorted = Array.from(catTotals.entries())
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 6)
                            const grandTotal = sorted.reduce(
                              (s, [, v]) => s + v,
                              0
                            )
                            return sorted.map(([name, spend]) => {
                              const pct =
                                grandTotal > 0
                                  ? Math.round((spend / grandTotal) * 100)
                                  : 0
                              return (
                                <div key={name} className="space-y-1">
                                  <div className="flex justify-between text-sm">
                                    <span className="font-medium">
                                      {name}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {formatCurrency(spend)} ({pct}%)
                                    </span>
                                  </div>
                                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-primary transition-all"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              )
                            })
                          })()}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            {/* Summary Report Tab */}
            <TabsContent value="report" className="space-y-6">
              {projections && projections.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      Projection Details
                    </CardTitle>
                    <CardDescription>
                      Monthly projected price changes over the next{" "}
                      {projections.length} periods
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="rounded-lg bg-muted/50 p-4 text-center">
                        <p className="text-sm text-muted-foreground">
                          Current Avg Price
                        </p>
                        <p className="text-xl font-bold">
                          $
                          {projections[0]?.currentPrice.toFixed(2) ?? "0.00"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-4 text-center">
                        <p className="text-sm text-muted-foreground">
                          Projected End Price
                        </p>
                        <p className="text-xl font-bold">
                          $
                          {projections[
                            projections.length - 1
                          ]?.projectedPrice.toFixed(2) ?? "0.00"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-4 text-center">
                        <p className="text-sm text-muted-foreground">
                          Total Change
                        </p>
                        <p
                          className={`text-xl font-bold ${
                            (projections[projections.length - 1]
                              ?.changePercent ?? 0) < 0
                              ? "text-emerald-600"
                              : "text-red-600"
                          }`}
                        >
                          {(
                            projections[projections.length - 1]
                              ?.changePercent ?? 0
                          ).toFixed(1)}
                          %
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Vendor Summary Cards */}
              {vendorTrends && vendorTrends.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(() => {
                    const vendorTotals = new Map<string, number>()
                    for (const item of vendorTrends) {
                      const name = item.vendorName ?? "Unknown"
                      vendorTotals.set(
                        name,
                        (vendorTotals.get(name) ?? 0) + item.spend
                      )
                    }
                    return Array.from(vendorTotals.entries())
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 6)
                      .map(([name, spend]) => (
                        <Card key={name}>
                          <CardContent className="pt-4">
                            <p className="text-sm font-medium truncate">
                              {name}
                            </p>
                            <p className="text-xl font-bold mt-1">
                              {formatCurrency(spend)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {
                                vendorTrends.filter(
                                  (t) => t.vendorName === name
                                ).length
                              }{" "}
                              months of data
                            </p>
                          </CardContent>
                        </Card>
                      ))
                  })()}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
