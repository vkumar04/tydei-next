"use client"

/**
 * Facility dashboard — client orchestrator.
 *
 * The server component (`app/dashboard/page.tsx`) fetches initial data in
 * parallel via the new dashboard-rewrite actions and passes it down.
 * This client component hydrates the three payloads into TanStack Query
 * so the rest of the app's mutation `onSuccess` handlers can invalidate
 * and refetch just the dashboard slices they touched.
 *
 * Keep this orchestrator ≤200 lines — presentation lives in the per-
 * section components.
 */

import { useQuery, type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { queryKeys } from "@/lib/query-keys"
import {
  getDashboardKPISummary,
  type DashboardKPISummary,
} from "@/lib/actions/dashboard/kpi"
import {
  getDashboardCharts,
  type DashboardChartsPayload,
} from "@/lib/actions/dashboard/lifecycle"
import { getContractStats } from "@/lib/actions/contracts"
import { DashboardKPICards } from "./dashboard-kpi-cards"
import { DashboardLifecyclePie } from "./dashboard-lifecycle-pie"
import { DashboardSpendTrendChart } from "./dashboard-spend-trend-chart"
import { DashboardTopAlerts } from "./dashboard-top-alerts"
import { DashboardSpendProjection } from "./dashboard-spend-projection"

export interface DashboardInitialData {
  kpiSummary: DashboardKPISummary
  charts: DashboardChartsPayload
  contractStats: ContractStats
}

export interface ContractStats {
  totalContracts: number
  totalValue: number
  totalRebates: number
}

interface DashboardClientProps {
  facilityId: string
  initialData: DashboardInitialData
  chartMonths: number
}

/** Seed the React Query cache with the server-rendered payload so the
 *  initial render is a cache hit (no loading flash) and subsequent
 *  refetches / invalidations work via queryClient. */
function seedCache(
  queryClient: QueryClient,
  facilityId: string,
  chartMonths: number,
  initial: DashboardInitialData,
): void {
  queryClient.setQueryData(
    queryKeys.dashboard.kpiSummary(facilityId),
    initial.kpiSummary,
  )
  queryClient.setQueryData(
    queryKeys.dashboard.charts(facilityId, chartMonths),
    initial.charts,
  )
  queryClient.setQueryData(
    queryKeys.dashboard.contractStats(facilityId),
    initial.contractStats,
  )
}

export function DashboardClient({
  facilityId,
  initialData,
  chartMonths,
}: DashboardClientProps) {
  const queryClient = useQueryClient()

  // Seed once per mount so server-rendered data hydrates the cache
  // before any hook reads it. Effect ordering is fine — the hooks
  // below pass `initialData` themselves too, belt-and-braces.
  useEffect(() => {
    seedCache(queryClient, facilityId, chartMonths, initialData)
    // We intentionally only want this to run on initial mount — the
    // initialData is snapshot data for this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const kpiQuery = useQuery({
    queryKey: queryKeys.dashboard.kpiSummary(facilityId),
    queryFn: () => getDashboardKPISummary(),
    initialData: initialData.kpiSummary,
  })

  const chartsQuery = useQuery({
    queryKey: queryKeys.dashboard.charts(facilityId, chartMonths),
    queryFn: () => getDashboardCharts({ months: chartMonths }),
    initialData: initialData.charts,
  })

  const statsQuery = useQuery({
    queryKey: queryKeys.dashboard.contractStats(facilityId),
    queryFn: () => getContractStats(),
    initialData: initialData.contractStats,
  })

  const kpi = kpiQuery.data
  const charts = chartsQuery.data
  const stats = statsQuery.data

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Dashboard
        </h1>
        <p className="text-muted-foreground">
          Overview of your contract portfolio, spend, and alerts
        </p>
      </div>

      <DashboardKPICards
        totalContracts={stats.totalContracts}
        activeContracts={kpi.activeContractsCount}
        totalContractValue={kpi.totalContractValue}
        totalSpendYTD={kpi.totalSpendYTD}
        totalRebatesEarned={kpi.totalRebatesEarned}
        pendingAlerts={kpi.pendingAlerts}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DashboardSpendTrendChart data={charts.monthlyTrend} />
        </div>
        <DashboardSpendProjection projection={kpi.spendProjection} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardLifecyclePie lifecycle={charts.lifecycle} />
        <DashboardTopAlerts
          alerts={kpi.topAlerts}
          totalUnresolved={kpi.alertSummary.totalUnresolved}
        />
      </div>
    </div>
  )
}
