"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { DepreciationCalculator } from "./depreciation-calculator"
import { DepreciationChart } from "./depreciation-chart"
import { PriceProjectionChart } from "./price-projection-chart"
import { SpendTrendChart } from "./spend-trend-chart"
import { usePriceProjections, useVendorSpendTrends, useCategorySpendTrends } from "@/hooks/use-analysis"
import type { DepreciationSchedule } from "@/lib/analysis/depreciation"

interface AnalysisClientProps {
  facilityId: string
}

export function AnalysisClient({ facilityId }: AnalysisClientProps) {
  const [schedule, setSchedule] = useState<DepreciationSchedule | null>(null)

  const now = new Date()
  const sixMonthsAgo = new Date(now)
  sixMonthsAgo.setMonth(now.getMonth() - 6)
  const dateRange = {
    from: sixMonthsAgo.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  }

  const { data: projections, isLoading: projLoading } = usePriceProjections(
    facilityId,
    { periods: 12 }
  )
  const { data: vendorTrends, isLoading: vtLoading } = useVendorSpendTrends(
    facilityId,
    dateRange
  )
  const { data: catTrends, isLoading: ctLoading } = useCategorySpendTrends(
    facilityId,
    dateRange
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial Analysis"
        description="Capital depreciation, price projections, and spend trends"
      />

      <Tabs defaultValue="depreciation">
        <TabsList>
          <TabsTrigger value="depreciation">Depreciation</TabsTrigger>
          <TabsTrigger value="projections">Price Projections</TabsTrigger>
          <TabsTrigger value="vendor-trends">Vendor Trends</TabsTrigger>
          <TabsTrigger value="category-trends">Category Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="depreciation" className="mt-4 space-y-4">
          <DepreciationCalculator onScheduleChange={setSchedule} />
          {schedule && <DepreciationChart schedule={schedule} />}
        </TabsContent>

        <TabsContent value="projections" className="mt-4">
          {projLoading ? (
            <Skeleton className="h-[340px] rounded-xl" />
          ) : (
            <PriceProjectionChart projections={projections ?? []} />
          )}
        </TabsContent>

        <TabsContent value="vendor-trends" className="mt-4">
          {vtLoading ? (
            <Skeleton className="h-[380px] rounded-xl" />
          ) : (
            <SpendTrendChart data={vendorTrends ?? []} groupBy="vendor" />
          )}
        </TabsContent>

        <TabsContent value="category-trends" className="mt-4">
          {ctLoading ? (
            <Skeleton className="h-[380px] rounded-xl" />
          ) : (
            <SpendTrendChart data={catTrends ?? []} groupBy="category" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
