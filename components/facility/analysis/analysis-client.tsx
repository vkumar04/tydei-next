"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { DepreciationCalculator } from "./depreciation-calculator"
import { DepreciationChart } from "./depreciation-chart"
import { PriceProjectionChart } from "./price-projection-chart"
import { SpendTrendChart } from "./spend-trend-chart"
import {
  usePriceProjections,
  useVendorSpendTrends,
  useCategorySpendTrends,
} from "@/hooks/use-analysis"
import type { DepreciationSchedule } from "@/lib/analysis/depreciation"
import { DollarSign, Percent, TrendingUp, Download, Calendar } from "lucide-react"

interface AnalysisClientProps {
  facilityId: string
}

export function AnalysisClient({ facilityId }: AnalysisClientProps) {
  const [schedule, setSchedule] = useState<DepreciationSchedule | null>(null)
  const [dateRangePreset, setDateRangePreset] = useState<string>("6m")

  const dateRange = useMemo(() => {
    const now = new Date()
    const from = new Date(now)
    switch (dateRangePreset) {
      case "1m":
        from.setMonth(now.getMonth() - 1)
        break
      case "3m":
        from.setMonth(now.getMonth() - 3)
        break
      case "6m":
        from.setMonth(now.getMonth() - 6)
        break
      case "12m":
        from.setMonth(now.getMonth() - 12)
        break
      default:
        from.setMonth(now.getMonth() - 6)
    }
    return {
      from: from.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    }
  }, [dateRangePreset])

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

  // Compute stat card values from fetched data
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
    <div className="space-y-6">
      <PageHeader
        title="Financial Analysis"
        description="Capital depreciation, price projections, and spend trends"
        action={
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        }
      />

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
                  {schedule ? formatCurrency(totalCapitalValue) : "--"}
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
                    Per year ({schedule.convention.replace("_", " ")})
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
                  {vtLoading ? "--" : formatCurrency(projectedAnnualSpend)}
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

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={dateRangePreset} onValueChange={setDateRangePreset}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1m">Last 1 month</SelectItem>
              <SelectItem value="3m">Last 3 months</SelectItem>
              <SelectItem value="6m">Last 6 months</SelectItem>
              <SelectItem value="12m">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {vendorTrends && vendorTrends.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {new Set(vendorTrends.map((t) => t.vendorName)).size} vendors
          </Badge>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="depreciation">
        <TabsList>
          <TabsTrigger value="depreciation">Depreciation</TabsTrigger>
          <TabsTrigger value="spend-trends">Spend Trends</TabsTrigger>
          <TabsTrigger value="projections">Price Projections</TabsTrigger>
          <TabsTrigger value="vendor-analysis">Vendor Analysis</TabsTrigger>
        </TabsList>

        {/* Depreciation Tab */}
        <TabsContent value="depreciation" className="mt-4 space-y-4">
          <DepreciationCalculator onScheduleChange={setSchedule} />
          {schedule && <DepreciationChart schedule={schedule} />}
        </TabsContent>

        {/* Spend Trends Tab */}
        <TabsContent value="spend-trends" className="mt-4 space-y-4">
          {vtLoading ? (
            <Skeleton className="h-[380px] rounded-xl" />
          ) : (
            <SpendTrendChart data={vendorTrends ?? []} groupBy="vendor" />
          )}

          {ctLoading ? (
            <Skeleton className="h-[380px] rounded-xl" />
          ) : (
            <>
              <SpendTrendChart data={catTrends ?? []} groupBy="category" />

              {/* Category Breakdown Summary */}
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
                                <span className="font-medium">{name}</span>
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

        {/* Price Projections Tab */}
        <TabsContent value="projections" className="mt-4">
          {projLoading ? (
            <Skeleton className="h-[340px] rounded-xl" />
          ) : (
            <PriceProjectionChart projections={projections ?? []} />
          )}

          {/* Projection Details */}
          {projections && projections.length > 0 && (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Projection Details</CardTitle>
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
                      ${projections[0]?.currentPrice.toFixed(2) ?? "0.00"}
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
                        (projections[projections.length - 1]?.changePercent ??
                          0) < 0
                          ? "text-emerald-600"
                          : "text-red-600"
                      }`}
                    >
                      {(
                        projections[projections.length - 1]?.changePercent ?? 0
                      ).toFixed(1)}
                      %
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Vendor Analysis Tab */}
        <TabsContent value="vendor-analysis" className="mt-4 space-y-4">
          {vtLoading ? (
            <Skeleton className="h-[380px] rounded-xl" />
          ) : (
            <>
              <SpendTrendChart data={vendorTrends ?? []} groupBy="vendor" />

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
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
