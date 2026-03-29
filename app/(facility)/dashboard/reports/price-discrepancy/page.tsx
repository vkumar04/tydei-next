"use client"

import { useQuery } from "@tanstack/react-query"
import { PageHeader } from "@/components/shared/page-header"
import { PriceDiscrepancyTable } from "@/components/facility/reports/price-discrepancy-table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { queryKeys } from "@/lib/query-keys"
import { getPriceDiscrepancies } from "@/lib/actions/reports"

export default function PriceDiscrepancyPage() {
  // We need facilityId; since this is a client page within facility layout, it's validated by layout
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports.priceDiscrepancies("current"),
    queryFn: () => getPriceDiscrepancies("current"),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Price Discrepancies"
        description="Invoice line items with contract price variance"
        action={
          <Link href="/dashboard/reports">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 size-4" /> Back to Reports
            </Button>
          </Link>
        }
      />
      {isLoading ? (
        <Skeleton className="h-[400px] rounded-xl" />
      ) : (
        <PriceDiscrepancyTable discrepancies={data ?? []} />
      )}
    </div>
  )
}
