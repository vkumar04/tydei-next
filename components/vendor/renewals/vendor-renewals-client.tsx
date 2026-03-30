"use client"

import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { VendorRenewalPipeline } from "./vendor-renewal-pipeline"
import { useExpiringContracts } from "@/hooks/use-renewals"
import { Calendar, Download, FileText } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"

interface VendorRenewalsClientProps {
  vendorId: string
}

export function VendorRenewalsClient({ vendorId }: VendorRenewalsClientProps) {
  const { data: contracts, isLoading } = useExpiringContracts(vendorId, 365, "vendor")

  const handleExportCalendar = () => {
    toast.success("Calendar exported", {
      description: "Renewal dates exported to your calendar",
    })
  }

  // Empty state
  if (!isLoading && (!contracts || contracts.length === 0)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Contract Renewals"
          description="Track and manage upcoming contract renewals across all facilities"
        />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Expiring Contracts</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              No contracts are expiring within the next year. Check back later or extend the window.
            </p>
            <Button asChild>
              <Link href="/vendor/contracts">View All Contracts</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contract Renewals"
        description="Track and manage upcoming contract renewals across all facilities"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportCalendar}>
              <Calendar className="mr-2 h-4 w-4" />
              Export Calendar
            </Button>
            <Button variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Export Report
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[160px] rounded-xl" />
          ))}
        </div>
      ) : (
        <VendorRenewalPipeline contracts={contracts ?? []} />
      )}
    </div>
  )
}
