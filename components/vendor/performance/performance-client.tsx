"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Calendar, Download } from "lucide-react"
import { PerformanceDashboard } from "./performance-dashboard"
import { getVendorPerformance } from "@/lib/actions/vendor-analytics"
import { queryKeys } from "@/lib/query-keys"

interface PerformanceClientProps {
  vendorId: string
}

export function PerformanceClient({ vendorId }: PerformanceClientProps) {
  const [timeRange, setTimeRange] = useState("ytd")

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.performance(vendorId),
    queryFn: () => getVendorPerformance(vendorId),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance Dashboard"
        description="Track contract performance, compliance, and rebate progress"
        action={
          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[140px]">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mtd">Month to Date</SelectItem>
                <SelectItem value="qtd">Quarter to Date</SelectItem>
                <SelectItem value="ytd">Year to Date</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Export Report
            </Button>
          </div>
        }
      />
      {isLoading || !data ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[380px] rounded-xl" />
        </div>
      ) : (
        <PerformanceDashboard data={data} />
      )}
    </div>
  )
}
