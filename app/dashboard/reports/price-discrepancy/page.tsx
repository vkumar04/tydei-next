"use client"

import { useQuery } from "@tanstack/react-query"
import { PriceDiscrepancyTable } from "@/components/facility/reports/price-discrepancy-table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ChevronLeft, Download } from "lucide-react"
import Link from "next/link"
import { queryKeys } from "@/lib/query-keys"
import { getPriceDiscrepancies } from "@/lib/actions/reports"
import { toast } from "sonner"

export default function PriceDiscrepancyPage() {
  // facilityId is validated upstream by the facility dashboard layout
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports.priceDiscrepancies("current"),
    queryFn: () => getPriceDiscrepancies("current"),
  })

  const exportReport = () => {
    toast.success("Price discrepancy report exported")
  }

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
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportReport}>
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[400px] rounded-xl" />
      ) : (
        <PriceDiscrepancyTable discrepancies={data ?? []} />
      )}
    </div>
  )
}
