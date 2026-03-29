"use client"

import { useState } from "react"
import { VendorStats } from "./vendor-stats"
import { VendorSpendChart } from "./vendor-spend-chart"
import { Skeleton } from "@/components/ui/skeleton"
import { useVendorDashboardStats, useVendorSpendTrend } from "@/hooks/use-vendor-dashboard"

function getDefaultRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), 0, 1)
  const to = new Date(now.getFullYear(), 11, 31)
  return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] }
}

interface VendorDashboardClientProps {
  vendorId: string
}

export function VendorDashboardClient({ vendorId }: VendorDashboardClientProps) {
  const [dateRange] = useState(getDefaultRange)
  const stats = useVendorDashboardStats(vendorId)
  const trend = useVendorSpendTrend(vendorId, dateRange)

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Vendor Dashboard
        </h1>
        <p className="text-muted-foreground">
          Overview of your contracts and facility relationships
        </p>
      </div>

      {stats.data ? (
        <VendorStats stats={stats.data} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[140px] rounded-xl" />
          ))}
        </div>
      )}

      {trend.data ? (
        <VendorSpendChart data={trend.data} />
      ) : (
        <Skeleton className="h-[380px] rounded-xl" />
      )}
    </div>
  )
}
