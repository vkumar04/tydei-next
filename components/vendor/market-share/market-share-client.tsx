"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MarketShareCharts } from "./market-share-charts"
import { getVendorMarketShare } from "@/lib/actions/vendor-analytics"
import { queryKeys } from "@/lib/query-keys"

interface MarketShareClientProps {
  vendorId: string
}

export function MarketShareClient({ vendorId }: MarketShareClientProps) {
  const [timeRange, setTimeRange] = useState("ytd")

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.marketShare(vendorId, { timeRange }),
    queryFn: () => getVendorMarketShare({ vendorId }),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market Share Analysis"
        description="Your market share across categories and facilities"
        action={
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ytd">Year to Date</SelectItem>
              <SelectItem value="qtd">Quarter to Date</SelectItem>
              <SelectItem value="12m">Last 12 Months</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {isLoading || !data ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[380px] rounded-xl" />
            <Skeleton className="h-[380px] rounded-xl" />
          </div>
        </div>
      ) : (
        <MarketShareCharts data={data} />
      )}
    </div>
  )
}
