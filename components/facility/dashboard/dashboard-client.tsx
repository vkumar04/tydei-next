"use client"

import { useMemo, useState } from "react"
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
import type { DateRange } from "@/lib/query-keys"

// "All time" sentinel — v0 shows undefined dates as "All Time". Tydei's server
// actions require concrete strings, so when the user hasn't picked a range we
// send a wide window that effectively means "all data".
const WIDE_RANGE: DateRange = {
  from: "1970-01-01",
  to: new Date().toISOString().split("T")[0]!,
}

interface DashboardClientProps {
  facilityId: string
}

export function DashboardClient({ facilityId }: DashboardClientProps) {
  // v0 parity: default to undefined (shows "All Time" in filter).
  const [pickedRange, setPickedRange] = useState<DateRange | undefined>(undefined)

  const effectiveRange = useMemo(() => pickedRange ?? WIDE_RANGE, [pickedRange])

  const stats = useDashboardStats(facilityId, effectiveRange)
  const monthlySpend = useMonthlySpend(facilityId, effectiveRange)
  const spendChart = useSpendByVendor(facilityId, effectiveRange)
  const categoryChart = useSpendByCategory(facilityId, effectiveRange)
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
      <DashboardFilters
        dateRange={pickedRange}
        onDateRangeChange={setPickedRange}
      />

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
