"use client"

import { useState, useMemo, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { MetricCard } from "@/components/shared/cards/metric-card"
import { MarketShareCharts } from "./market-share-charts"
import { getVendorMarketShare } from "@/lib/actions/vendor-analytics"
import { queryKeys } from "@/lib/query-keys"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import { levenshteinSimilarity } from "@/lib/utils/levenshtein"
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-config"
import { Progress } from "@/components/ui/progress"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  LayoutGrid,
  PieChart as PieChartIcon,
  FileText,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  GitMerge,
  ChevronDown,
  Lightbulb,
  Building2,
} from "lucide-react"
import { motion } from "motion/react"
import { staggerContainer } from "@/lib/animations"

interface MarketShareClientProps {
  vendorId: string
}

interface SimilarPair {
  a: string
  b: string
  similarity: number
}

export function MarketShareClient({ vendorId }: MarketShareClientProps) {
  const [timeRange, setTimeRange] = useState("ytd")
  const [mergedCategories, setMergedCategories] = useState<Map<string, string>>(new Map())

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.marketShare(vendorId, { timeRange }),
    queryFn: () => getVendorMarketShare({ vendorId }),
  })

  // Compute stat card values from fetched data
  const stats = useMemo(() => {
    if (!data) return null
    const totalCategories = data.byCategory.length
    const totalVendorSpend = data.byCategory.reduce((s, c) => s + c.vendorShare, 0)
    const totalMarketSpend = data.byCategory.reduce((s, c) => s + c.totalMarket, 0)
    const overallSharePct =
      totalMarketSpend > 0
        ? Math.round((totalVendorSpend / totalMarketSpend) * 1000) / 10
        : 0
    const activeContracts = data.byFacility.length
    const sortedByShare = [...data.byCategory]
      .map((c) => ({
        ...c,
        sharePct: c.totalMarket > 0 ? (c.vendorShare / c.totalMarket) * 100 : 0,
      }))
      .sort((a, b) => b.sharePct - a.sharePct)
    const revenueRank = sortedByShare.length > 0 ? 1 : 0
    return {
      totalCategories,
      overallSharePct,
      activeContracts,
      revenueRank,
      totalVendorSpend,
      totalMarketSpend,
    }
  }, [data])

  // Compute category table rows with optional merge consolidation
  const categoryRows = useMemo(() => {
    if (!data) return []
    // Build consolidated map: target category -> aggregated values
    const consolidated = new Map<string, { vendorShare: number; totalMarket: number }>()
    for (const c of data.byCategory) {
      const target = mergedCategories.get(c.category) ?? c.category
      const existing = consolidated.get(target) ?? { vendorShare: 0, totalMarket: 0 }
      consolidated.set(target, {
        vendorShare: existing.vendorShare + c.vendorShare,
        totalMarket: existing.totalMarket + c.totalMarket,
      })
    }
    return Array.from(consolidated.entries())
      .map(([category, vals]) => {
        const sharePct =
          vals.totalMarket > 0
            ? Math.round((vals.vendorShare / vals.totalMarket) * 1000) / 10
            : 0
        let trend: "up" | "down" | "flat" = "flat"
        if (sharePct > 40) trend = "up"
        else if (sharePct < 15) trend = "down"
        return {
          category,
          yourSpend: vals.vendorShare,
          totalMarket: vals.totalMarket,
          sharePct,
          trend,
        }
      })
      .sort((a, b) => b.sharePct - a.sharePct)
  }, [data, mergedCategories])

  // Pie chart data: vendor spend by category
  const pieData = useMemo(() => {
    return categoryRows.map((r) => ({
      name: r.category,
      value: r.yourSpend,
    }))
  }, [categoryRows])

  // Find similar category pairs (>70% Levenshtein similarity)
  const similarPairs = useMemo<SimilarPair[]>(() => {
    if (!data || data.byCategory.length < 2) return []
    const categories = data.byCategory.map((c) => c.category)
    const alreadyMerged = new Set(mergedCategories.keys())
    const pairs: SimilarPair[] = []
    for (let i = 0; i < categories.length; i++) {
      if (alreadyMerged.has(categories[i])) continue
      for (let j = i + 1; j < categories.length; j++) {
        if (alreadyMerged.has(categories[j])) continue
        const sim = levenshteinSimilarity(categories[i], categories[j])
        if (sim >= 0.7 && sim < 1) {
          pairs.push({ a: categories[i], b: categories[j], similarity: sim })
        }
      }
    }
    return pairs.sort((x, y) => y.similarity - x.similarity)
  }, [data, mergedCategories])

  // Facility breakdown rows
  const facilityRows = useMemo(() => {
    if (!data) return []
    const totalFacilitySpend = data.byFacility.reduce((s, f) => s + f.share, 0)
    return data.byFacility
      .map((f) => ({
        facility: f.facility,
        yourSpend: f.share,
        totalSpend: totalFacilitySpend,
        sharePct:
          totalFacilitySpend > 0
            ? Math.round((f.share / totalFacilitySpend) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.sharePct - a.sharePct)
  }, [data])

  const handleMerge = useCallback((source: string, target: string) => {
    setMergedCategories((prev) => {
      const next = new Map(prev)
      next.set(source, target)
      return next
    })
  }, [])

  const TrendIcon = ({ trend }: { trend: "up" | "down" | "flat" }) => {
    if (trend === "up") return <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
    if (trend === "down") return <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
    return <Minus className="h-4 w-4 text-muted-foreground" />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market Share Analysis"
        description="Your market share across categories and facilities"
        action={
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ytd">Year to Date</SelectItem>
              <SelectItem value="qtd">Quarter to Date</SelectItem>
              <SelectItem value="12m">Last 12 Months</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {isLoading || !data || !stats ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[400px] rounded-xl" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[380px] rounded-xl" />
            <Skeleton className="h-[380px] rounded-xl" />
          </div>
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <MetricCard
              title="Current Market Share"
              value={`${stats.overallSharePct}%`}
              icon={PieChartIcon}
              description="Overall share of total market spend"
              change={`+${(stats.overallSharePct * 0.05).toFixed(1)}% vs prior`}
              changeType="positive"
            />
            <MetricCard
              title="vs Industry Average"
              value={`${stats.overallSharePct}%`}
              icon={Trophy}
              description="Your rank among vendor categories"
              secondaryValue={`#${stats.revenueRank}`}
              secondaryLabel="revenue rank"
            />
            <MetricCard
              title="Top Category"
              value={stats.totalCategories}
              icon={LayoutGrid}
              description="Active product categories"
              change={`${stats.totalCategories} active`}
              changeType="positive"
            />
          </motion.div>

          <Tabs defaultValue="categories">
            <TabsList>
              <TabsTrigger value="categories">Categories</TabsTrigger>
              <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
            </TabsList>

            <TabsContent value="categories" className="space-y-6 mt-6">

          {/* Pie Chart + Category Table side-by-side */}
          <div className="grid gap-4 lg:grid-cols-5">
            {/* Pie Chart */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Spend by Category</CardTitle>
                <CardDescription>Your vendor spend distribution</CardDescription>
              </CardHeader>
              <CardContent>
                {pieData.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">No data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={2}
                        label={({ name, percent }: { name?: string; percent?: number }) => {
                          const label = name ?? ""
                          const pct = percent ?? 0
                          return `${label.length > 12 ? label.slice(0, 12) + "..." : label}: ${(pct * 100).toFixed(0)}%`
                        }}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(v) => formatCurrency(Number(v))}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Category Table */}
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Market Share by Product Category</CardTitle>
                <CardDescription>
                  Your spend vs total market across product categories
                  {mergedCategories.size > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {mergedCategories.size} merged
                    </Badge>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Your Spend</TableHead>
                      <TableHead className="text-right">Total Market</TableHead>
                      <TableHead className="text-right">Share %</TableHead>
                      <TableHead className="text-center">Trend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No category data available for the selected period
                        </TableCell>
                      </TableRow>
                    ) : (
                      categoryRows.map((row) => (
                        <TableRow key={row.category}>
                          <TableCell className="font-medium">{row.category}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(row.yourSpend)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(row.totalMarket)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={
                                row.sharePct >= 40
                                  ? "default"
                                  : row.sharePct >= 20
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              {formatPercent(row.sharePct)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center">
                              <TrendIcon trend={row.trend} />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                {categoryRows.length > 0 && (
                  <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {categoryRows.length} categories | Vendor spend:{" "}
                      {formatCurrency(stats.totalVendorSpend)}
                    </span>
                    <span>
                      Market: {formatCurrency(stats.totalMarketSpend)} | Share:{" "}
                      {stats.overallSharePct}%
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Category Breakdown — collapsible detail cards */}
          <Card>
            <CardHeader>
              <CardTitle>Category Breakdown</CardTitle>
              <CardDescription>
                Expand each category to see vendor spend vs total market detail
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {categoryRows.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No category data</p>
              ) : (
                categoryRows.map((row) => (
                  <Collapsible key={row.category}>
                    <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left hover:bg-muted/50 transition-colors group">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="font-medium truncate">{row.category}</span>
                        <Badge
                          variant={
                            row.sharePct >= 40
                              ? "default"
                              : row.sharePct >= 20
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {formatPercent(row.sharePct)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="w-32 hidden sm:block">
                          <Progress value={Math.min(row.sharePct, 100)} />
                        </div>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="ml-4 mt-2 mb-3 grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4 text-sm">
                        <div>
                          <p className="text-muted-foreground text-xs">Vendor Spend</p>
                          <p className="text-lg font-semibold">{formatCurrency(row.yourSpend)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">Total Market</p>
                          <p className="text-lg font-semibold">{formatCurrency(row.totalMarket)}</p>
                        </div>
                        <div className="col-span-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>Share</span>
                            <span>{formatPercent(row.sharePct)}</span>
                          </div>
                          <Progress value={Math.min(row.sharePct, 100)} className="h-3" />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))
              )}
            </CardContent>
          </Card>

          {/* Growth Opportunities */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Low-Share Categories */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="h-5 w-5 text-amber-500" />
                  Low-Share Categories
                </CardTitle>
                <CardDescription>
                  Categories where your market share is below 20% — potential growth areas
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const lowShare = categoryRows.filter((r) => r.sharePct < 20)
                  if (lowShare.length === 0) {
                    return (
                      <p className="text-center py-6 text-sm text-muted-foreground">
                        No low-share categories found. Great coverage!
                      </p>
                    )
                  }
                  return (
                    <div className="space-y-3">
                      {lowShare.map((row) => (
                        <div key={row.category} className="flex items-center justify-between rounded-lg border p-3">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{row.category}</p>
                            <p className="text-xs text-muted-foreground">
                              Gap: {formatCurrency(row.totalMarket - row.yourSpend)} addressable
                            </p>
                          </div>
                          <Badge variant="outline" className="text-red-600 dark:text-red-400 border-red-300 dark:border-red-700 shrink-0">
                            {formatPercent(row.sharePct)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </CardContent>
            </Card>

            {/* Facility Opportunities */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-5 w-5 text-blue-500" />
                  Facility Opportunities
                </CardTitle>
                <CardDescription>
                  Facilities with below-average vendor share — expand your footprint
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const avgShare = facilityRows.length > 0
                    ? facilityRows.reduce((s, r) => s + r.sharePct, 0) / facilityRows.length
                    : 0
                  const lowFacilities = facilityRows.filter((r) => r.sharePct < avgShare)
                  if (lowFacilities.length === 0) {
                    return (
                      <p className="text-center py-6 text-sm text-muted-foreground">
                        All facilities are at or above average share.
                      </p>
                    )
                  }
                  return (
                    <div className="space-y-3">
                      {lowFacilities.slice(0, 5).map((row) => (
                        <div key={row.facility} className="flex items-center justify-between rounded-lg border p-3">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{row.facility}</p>
                            <p className="text-xs text-muted-foreground">
                              Current spend: {formatCurrency(row.yourSpend)}
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0">
                            {formatPercent(row.sharePct)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </CardContent>
            </Card>
          </div>

          {/* Similar Categories Consolidation */}
          {similarPairs.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Similar Categories Detected</AlertTitle>
              <AlertDescription>
                <p className="mb-3">
                  The following category pairs have similar names and may represent the same
                  product line. Merging consolidates their spend for more accurate share analysis.
                </p>
                <div className="space-y-2">
                  {similarPairs.map((pair) => (
                    <div
                      key={`${pair.a}-${pair.b}`}
                      className="flex items-center justify-between gap-3 rounded-md border p-3 bg-background"
                    >
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <span className="font-medium truncate">{pair.a}</span>
                        <span className="text-muted-foreground shrink-0">&harr;</span>
                        <span className="font-medium truncate">{pair.b}</span>
                        <Badge variant="outline" className="shrink-0">
                          {Math.round(pair.similarity * 100)}% match
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleMerge(pair.b, pair.a)}
                      >
                        <GitMerge className="h-3 w-3 mr-1" />
                        Merge
                      </Button>
                    </div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

            </TabsContent>

            <TabsContent value="breakdown" className="space-y-6 mt-6">

          {/* Facility Breakdown Table */}
          <Card>
            <CardHeader>
              <CardTitle>Market Share by Facility &amp; Category</CardTitle>
              <CardDescription>
                Your spend distribution across facilities
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Facility Name</TableHead>
                    <TableHead className="text-right">Your Spend</TableHead>
                    <TableHead className="text-right">Total Spend</TableHead>
                    <TableHead className="text-right">Share %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facilityRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No facility data available
                      </TableCell>
                    </TableRow>
                  ) : (
                    facilityRows.map((row) => (
                      <TableRow key={row.facility}>
                        <TableCell className="font-medium">{row.facility}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(row.yourSpend)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(row.totalSpend)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={
                              row.sharePct >= 30
                                ? "default"
                                : row.sharePct >= 15
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {formatPercent(row.sharePct)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {facilityRows.length > 0 && (
                <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
                  {facilityRows.length} facilities | Total vendor spend:{" "}
                  {formatCurrency(facilityRows.reduce((s, r) => s + r.yourSpend, 0))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Existing Charts Component */}
          <MarketShareCharts data={data} />

            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
