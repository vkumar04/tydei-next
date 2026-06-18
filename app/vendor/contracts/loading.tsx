import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

/**
 * Vendor contracts loading skeleton — mirrors `app/vendor/contracts/page.tsx`:
 * a PageHeader (title "My Contracts" + description on the left, two action
 * buttons on the right) over the VendorContractList table Card.
 */
export default function VendorContractsLoading() {
  return (
    <div className="space-y-6">
      {/* PageHeader: title + description left, 2 action buttons right */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-44 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
      </div>

      {/* Contracts table */}
      <Card className="p-6">
        <Skeleton className="mb-2 h-5 w-28" />
        <Skeleton className="mb-6 h-4 w-40" />
        <div className="space-y-3">
          {/* table header */}
          <Skeleton className="h-10 w-full rounded" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded" />
          ))}
        </div>
      </Card>
    </div>
  )
}
