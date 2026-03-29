"use client"

import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { PerformanceDashboard } from "./performance-dashboard"
import { getVendorPerformance } from "@/lib/actions/vendor-analytics"
import { queryKeys } from "@/lib/query-keys"

interface PerformanceClientProps {
  vendorId: string
}

export function PerformanceClient({ vendorId }: PerformanceClientProps) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.performance(vendorId),
    queryFn: () => getVendorPerformance(vendorId),
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Performance" description="Your performance KPIs and multi-dimension scoring" />
      {isLoading || !data ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[120px] rounded-xl" />)}
          </div>
          <Skeleton className="h-[380px] rounded-xl" />
        </div>
      ) : (
        <PerformanceDashboard data={data} />
      )}
    </div>
  )
}
