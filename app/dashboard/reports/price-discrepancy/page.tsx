"use client"

import { useQuery } from "@tanstack/react-query"
import { PriceDiscrepancyTable } from "@/components/facility/reports/price-discrepancy-table"
import { PriceVarianceDashboard } from "@/components/facility/reports/price-variance-dashboard"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { queryKeys } from "@/lib/query-keys"
import { getPriceDiscrepancies } from "@/lib/actions/reports"

export default function PriceDiscrepancyPage() {
  // facilityId is validated upstream by the facility dashboard layout
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports.priceDiscrepancies("current"),
    queryFn: () => getPriceDiscrepancies("current"),
  })

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/reports">
            <Button variant="ghost" size="icon">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-balance">
              Price Discrepancy Report
            </h1>
            <p className="text-muted-foreground">
              Identify and resolve pricing variances between contracts, pricing
              files, and actual purchases
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="severity" className="space-y-6">
        <TabsList>
          <TabsTrigger value="severity">By severity</TabsTrigger>
          <TabsTrigger value="detail">Line-item detail</TabsTrigger>
        </TabsList>
        <TabsContent value="severity" className="space-y-6">
          <PriceVarianceDashboard facilityId="current" />
        </TabsContent>
        <TabsContent value="detail" className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : (
            <PriceDiscrepancyTable discrepancies={data ?? []} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
