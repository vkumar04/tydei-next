"use client"

import { useState } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { DashboardFilters } from "./dashboard-filters"
import { DashboardStats } from "./dashboard-stats"
import { EarnedRebateChart } from "./earned-rebate-chart"
import { SpendByVendorChart } from "./spend-by-vendor-chart"
import { ContractLifecycleChart } from "./contract-lifecycle-chart"
import { SpendTierChart } from "./spend-tier-chart"
import { RecentContracts } from "./recent-contracts"
import { RecentAlerts } from "./recent-alerts"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useDashboardStats,
  useEarnedRebateByMonth,
  useSpendByVendor,
  useContractLifecycle,
  useSpendNeededForTier,
  useRecentContracts,
  useRecentAlerts,
} from "@/hooks/use-dashboard"

function getDefaultRange() {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const from = new Date(now.getFullYear(), q * 3, 1)
  const to = new Date(now.getFullYear(), q * 3 + 3, 0)
  return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] }
}

interface DashboardClientProps {
  facilityId: string
}

export function DashboardClient({ facilityId }: DashboardClientProps) {
  const [dateRange, setDateRange] = useState(getDefaultRange)

  const stats = useDashboardStats(facilityId, dateRange)
  const rebateChart = useEarnedRebateByMonth(facilityId, dateRange)
  const spendChart = useSpendByVendor(facilityId, dateRange)
  const lifecycle = useContractLifecycle(facilityId)
  const tierChart = useSpendNeededForTier(facilityId)
  const recentContracts = useRecentContracts(facilityId)
  const recentAlerts = useRecentAlerts(facilityId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your contracts, spend, and performance"
        action={<DashboardFilters dateRange={dateRange} onDateRangeChange={setDateRange} />}
      />

      {stats.data ? (
        <DashboardStats stats={stats.data} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-xl" />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {rebateChart.data ? (
          <EarnedRebateChart data={rebateChart.data} />
        ) : (
          <Skeleton className="h-[380px] rounded-xl" />
        )}
        {spendChart.data ? (
          <SpendByVendorChart data={spendChart.data} />
        ) : (
          <Skeleton className="h-[380px] rounded-xl" />
        )}
        {lifecycle.data ? (
          <ContractLifecycleChart data={lifecycle.data} />
        ) : (
          <Skeleton className="h-[380px] rounded-xl" />
        )}
        {tierChart.data ? (
          <SpendTierChart data={tierChart.data} />
        ) : (
          <Skeleton className="h-[380px] rounded-xl" />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {recentContracts.data ? (
          <RecentContracts contracts={recentContracts.data} />
        ) : (
          <Skeleton className="h-[300px] rounded-xl" />
        )}
        {recentAlerts.data ? (
          <RecentAlerts alerts={recentAlerts.data} />
        ) : (
          <Skeleton className="h-[300px] rounded-xl" />
        )}
      </div>
    </div>
  )
}
