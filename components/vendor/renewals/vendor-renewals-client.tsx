"use client"

import { PageHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { VendorRenewalPipeline } from "./vendor-renewal-pipeline"
import { useExpiringContracts } from "@/hooks/use-renewals"

interface VendorRenewalsClientProps {
  vendorId: string
}

export function VendorRenewalsClient({ vendorId }: VendorRenewalsClientProps) {
  const { data: contracts, isLoading } = useExpiringContracts(vendorId, 120, "vendor")

  return (
    <div className="space-y-6">
      <PageHeader
        title="Renewal Pipeline"
        description="Track expiring contracts and plan renewal strategies"
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
