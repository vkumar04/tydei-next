"use client"

import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { MarketShareCharts } from "./market-share-charts"
import { getVendorMarketShare } from "@/lib/actions/vendor-analytics"
import { queryKeys } from "@/lib/query-keys"

interface MarketShareClientProps {
  vendorId: string
}

export function MarketShareClient({ vendorId }: MarketShareClientProps) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.marketShare(vendorId),
    queryFn: () => getVendorMarketShare({ vendorId }),
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Market Share" description="Your share of total spend across facilities and categories" />
      {isLoading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[380px] rounded-xl" />
          <Skeleton className="h-[380px] rounded-xl" />
        </div>
      ) : (
        <MarketShareCharts data={data} />
      )}
    </div>
  )
}
