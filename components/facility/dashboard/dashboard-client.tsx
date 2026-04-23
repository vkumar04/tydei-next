"use client"

/**
 * Facility dashboard — client orchestrator.
 *
 * 2026-04-22 redesign — Pattern 1 (hero + tabbed details), matching the
 * Analysis, Rebate Optimizer, AI Assistant, and Contracts pages:
 *
 *   1. Page header (title + subtitle).
 *   2. DashboardHero — elevated panel with 4 big numbers
 *      (Active / Total Spend / Rebates / Pending Alerts).
 *   3. Tabs — Overview, Spend, Alerts. One coherent panel at a time
 *      instead of 8+ cards simultaneously.
 *
 * The server component (`app/dashboard/page.tsx`) fetches initial data
 * in parallel and passes it down; hooks below seed TanStack Query so
 * mutation `onSuccess` handlers can invalidate specific slices.
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DashboardHero } from "./dashboard-hero"
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

  useEffect(() => {
    seedCache(queryClient, facilityId, chartMonths, initialData)
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

      <DashboardHero
        totalContracts={stats.totalContracts}
        activeContracts={kpi.activeContractsCount}
        totalContractValue={kpi.totalContractValue}
        totalSpendYTD={kpi.totalSpendYTD}
        onContractSpendYTD={kpi.onContractSpendYTD}
        totalRebatesEarned={kpi.totalRebatesEarned}
        totalRebatesCollected={kpi.totalRebatesCollected}
        pendingAlerts={kpi.pendingAlerts}
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="spend">Spend</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <DashboardSpendTrendChart data={charts.monthlyTrend} />
            </div>
            <DashboardLifecyclePie lifecycle={charts.lifecycle} />
          </div>
        </TabsContent>

        <TabsContent value="spend" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <DashboardSpendTrendChart data={charts.monthlyTrend} />
            </div>
            <DashboardSpendProjection projection={kpi.spendProjection} />
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <DashboardTopAlerts
            alerts={kpi.topAlerts}
            totalUnresolved={kpi.alertSummary.totalUnresolved}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
