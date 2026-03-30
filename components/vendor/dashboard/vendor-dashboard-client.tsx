"use client"

import { useState } from "react"
import { Building2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { VendorStats } from "./vendor-stats"
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

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Vendor Dashboard
        </h1>
        <p className="text-muted-foreground">
          Overview of your contract performance across facilities
        </p>
      </div>

      {/* Info Banner */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">
                Vendor View Active - {vendorName}
              </p>
              <p className="text-xs text-muted-foreground">
                You are viewing aggregated data. Individual facility pricing and
                competitor details are not visible.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metric Cards */}
      {stats.data ? (
        <VendorStats stats={stats.data} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[140px] rounded-xl" />
          ))}
        </div>
      )}

      {/* Charts: Spend Trend + Market Share by Category */}
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

      {/* Contract Status + Recent Contracts */}
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
    </div>
  )
}
