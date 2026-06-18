import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

/**
 * Vendor contract detail loading skeleton — mirrors
 * `app/vendor/contracts/[id]/vendor-contract-detail-client.tsx`: a PageHeader
 * (contract name + "Contract details" + a "Propose Changes" button), the
 * Overview/Accruals/[Amortization]/Performance/Pricing/Documents tab strip
 * (~6 tabs), and the Overview content (2-col grid of cards + one wide card).
 */
export default function VendorContractDetailLoading() {
  return (
    <div className="space-y-6">
      {/* PageHeader: contract name + subtitle left, edit button right */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>

      {/* Tab strip (~6 tabs) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>

      {/* Overview content: 2-col card grid + one wide card */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <Skeleton className="mb-4 h-5 w-32" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <Skeleton className="mb-4 h-5 w-32" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <Skeleton className="mb-4 h-5 w-40" />
        <Skeleton className="h-24 w-full rounded" />
      </Card>
    </div>
  )
}
