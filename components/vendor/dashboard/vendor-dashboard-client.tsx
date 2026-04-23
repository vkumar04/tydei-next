"use client"

import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VendorDashboardHero } from "./vendor-dashboard-hero"
import { VendorSpendChart } from "./vendor-spend-chart"
import { VendorMarketShareChart } from "./vendor-market-share-chart"
import { VendorContractStatus } from "./vendor-contract-status"
import { VendorRecentContracts } from "./vendor-recent-contracts"
import {
  useVendorDashboardStats,
  useVendorSpendTrend,
  useVendorMarketShareByCategory,
  useVendorContractStatus,
  useVendorRecentContracts,
} from "@/hooks/use-vendor-dashboard"

function getDefaultRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), 0, 1)
  const to = new Date(now.getFullYear(), 11, 31)
  return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] }
}

interface VendorDashboardClientProps {
  vendorId: string
  vendorName: string
}

export function VendorDashboardClient({ vendorId, vendorName }: VendorDashboardClientProps) {
  const [dateRange] = useState(getDefaultRange)
  const stats = useVendorDashboardStats(vendorId)
  const trend = useVendorSpendTrend(vendorId, dateRange)
  const marketShare = useVendorMarketShareByCategory(vendorId)
  const contractStatus = useVendorContractStatus(vendorId)
  const recentContracts = useVendorRecentContracts(vendorId)

  const statsData = stats.data

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Vendor Dashboard
        </h1>
        <p className="text-muted-foreground">
          Overview of your contract performance across facilities
        </p>
      </div>

      <VendorDashboardHero
        vendorName={vendorName}
        activeContracts={statsData?.activeContracts ?? 0}
        totalContracts={statsData?.totalContracts ?? 0}
        totalSpend={statsData?.totalSpend ?? 0}
        totalRebates={statsData?.totalRebates ?? 0}
        activeFacilities={statsData?.activeFacilities ?? 0}
        marketSharePercent={statsData?.marketSharePercent ?? 0}
        isLoading={!statsData}
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            {trend.data ? (
              <VendorSpendChart data={trend.data} />
            ) : (
              <Skeleton className="h-[380px] rounded-xl" />
            )}

            {marketShare.data ? (
              <VendorMarketShareChart data={marketShare.data} />
            ) : (
              <Skeleton className="h-[380px] rounded-xl" />
            )}
          </div>
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          {trend.data ? (
            <VendorSpendChart data={trend.data} />
          ) : (
            <Skeleton className="h-[380px] rounded-xl" />
          )}
        </TabsContent>

        <TabsContent value="contracts" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-3">
            {contractStatus.data ? (
              <VendorContractStatus data={contractStatus.data} />
            ) : (
              <Skeleton className="h-[280px] rounded-xl" />
            )}

            {recentContracts.data ? (
              <VendorRecentContracts data={recentContracts.data} />
            ) : (
              <Skeleton className="h-[280px] rounded-xl lg:col-span-2" />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
