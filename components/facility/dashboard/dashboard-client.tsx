"use client"

import { useState } from "react"
import { DashboardFilters } from "./dashboard-filters"
import { DashboardStats } from "./dashboard-stats"
import { TotalSpendChart } from "./total-spend-chart"
import { SpendByVendorChart } from "./spend-by-vendor-chart"
import { SpendByCategoryChart } from "./spend-by-category-chart"
import { RecentContracts } from "./recent-contracts"
import { RecentAlerts } from "./recent-alerts"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useDashboardStats,
  useMonthlySpend,
  useSpendByVendor,
  useSpendByCategory,
  useRecentContracts,
  useRecentAlerts,
} from "@/hooks/use-dashboard"

function getDefaultRange() {
  const now = new Date()
  // Look back 12 months so historical COG data is visible by default
  const from = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  return { from: from.toISOString().split("T")[0], to: now.toISOString().split("T")[0] }
}

interface DashboardClientProps {
  facilityId: string
}

export function DashboardClient({ facilityId }: DashboardClientProps) {
  const [dateRange, setDateRange] = useState(getDefaultRange)

  const stats = useDashboardStats(facilityId, dateRange)
  const monthlySpend = useMonthlySpend(facilityId, dateRange)
  const spendChart = useSpendByVendor(facilityId, dateRange)
  const categoryChart = useSpendByCategory(facilityId, dateRange)
  const recentContracts = useRecentContracts(facilityId)
  const recentAlerts = useRecentAlerts(facilityId)

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-balance">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your contract performance and analytics
        </p>
      </div>

      {/* Filters */}
      <DashboardFilters dateRange={dateRange} onDateRangeChange={setDateRange} />

      {/* Metrics cards */}
      {stats.data ? (
        <DashboardStats stats={stats.data} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}

      {/* Charts - v0 layout: full-width spend trend, then 2-col vendor + category */}
      <div className="space-y-6">
        {monthlySpend.data ? (
          <TotalSpendChart data={monthlySpend.data} />
        ) : (
          <Skeleton className="h-80" />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {spendChart.data ? (
            <SpendByVendorChart data={spendChart.data} />
          ) : (
            <Skeleton className="h-80" />
          )}
          {categoryChart.data ? (
            <SpendByCategoryChart data={categoryChart.data} />
          ) : (
            <Skeleton className="h-80" />
          )}
        </div>
      </div>

      {/* Recent data */}
      <div className="grid gap-6 lg:grid-cols-2">
        {recentContracts.data ? (
          <RecentContracts contracts={recentContracts.data} />
        ) : (
          <Skeleton className="h-96" />
        )}
        {recentAlerts.data ? (
          <RecentAlerts alerts={recentAlerts.data} />
        ) : (
          <Skeleton className="h-96" />
        )}
      </div>
    </div>
  )
}
