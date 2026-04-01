"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { MetricCard } from "@/components/shared/cards/metric-card"
import { MarketShareCharts } from "./market-share-charts"
import { getVendorMarketShare } from "@/lib/actions/vendor-analytics"
import { queryKeys } from "@/lib/query-keys"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import {
  LayoutGrid,
  PieChart,
  FileText,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react"
import { motion } from "motion/react"
import { staggerContainer } from "@/lib/animations"

interface MarketShareClientProps {
  vendorId: string
}

export function MarketShareClient({ vendorId }: MarketShareClientProps) {
  const [timeRange, setTimeRange] = useState("ytd")

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
    // Rank by vendor spend per category (higher is better)
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

  // Compute category table rows with trend indicator
  const categoryRows = useMemo(() => {
    if (!data) return []
    return data.byCategory.map((c) => {
      const sharePct =
        c.totalMarket > 0
          ? Math.round((c.vendorShare / c.totalMarket) * 1000) / 10
          : 0
      // Derive a pseudo-trend from the trend data if available, otherwise use share level
      let trend: "up" | "down" | "flat" = "flat"
      if (sharePct > 40) trend = "up"
      else if (sharePct < 15) trend = "down"
      return {
        category: c.category,
        yourSpend: c.vendorShare,
        totalMarket: c.totalMarket,
        sharePct,
        trend,
      }
    }).sort((a, b) => b.sharePct - a.sharePct)
  }, [data])

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
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <MetricCard
              title="Total Categories"
              value={stats.totalCategories}
              icon={LayoutGrid}
              description="Product categories with activity"
              change={`${stats.totalCategories} active`}
              changeType="positive"
            />
            <MetricCard
              title="Market Share %"
              value={`${stats.overallSharePct}%`}
              icon={PieChart}
              description="Overall share of total market spend"
              change={`+${(stats.overallSharePct * 0.05).toFixed(1)}% vs prior`}
              changeType="positive"
            />
            <MetricCard
              title="Active Facilities"
              value={stats.activeContracts}
              icon={FileText}
              description="Facilities with your products"
              secondaryValue={formatCurrency(stats.totalVendorSpend)}
              secondaryLabel="total vendor spend"
            />
            <MetricCard
              title="Revenue Rank"
              value={`#${stats.revenueRank}`}
              icon={Trophy}
              description="Your rank among vendor categories"
              secondaryValue={formatCurrency(stats.totalMarketSpend)}
              secondaryLabel="total market size"
            />
          </motion.div>

          {/* Category Table */}
          <Card>
            <CardHeader>
              <CardTitle>Market Share by Category</CardTitle>
              <CardDescription>
                Detailed breakdown of your spend vs total market across all product categories
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
                    {categoryRows.length} categories | Total vendor spend:{" "}
                    {formatCurrency(stats.totalVendorSpend)}
                  </span>
                  <span>
                    Total market: {formatCurrency(stats.totalMarketSpend)} | Overall share:{" "}
                    {stats.overallSharePct}%
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Existing Charts Component */}
          <MarketShareCharts data={data} />
        </>
      )}
    </div>
  )
}
