import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

/**
 * Invoice detail loading skeleton — mirrors the real layout in
 * `app/dashboard/invoice-validation/[id]/page.tsx` +
 * `components/facility/invoices/invoice-validation-detail.tsx`: PageHeader
 * (Invoice {number} + "Vendor - Validation results"), the status-badge row,
 * the 3-card variance summary (Invoiced / Contract total / Total overcharge),
 * and the "Line Item Validation" table card. 2026-06-18: added the 3-card
 * summary grid the previous skeleton was missing.
 */
export default function InvoiceDetailLoading() {
  return (
    <div className="space-y-6">
      {/* PageHeader */}
      <div className="space-y-1">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-56" />
      </div>

      {/* Status-badge row */}
      <div className="flex flex-wrap items-center gap-4">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="ml-auto h-8 w-32 rounded-md" />
      </div>

      {/* 3-card variance summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-28" />
          </Card>
        ))}
      </div>

      {/* Line Item Validation table */}
      <Card className="p-4">
        <Skeleton className="mb-4 h-5 w-40" />
        <Skeleton className="mb-3 h-10 w-full" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </Card>
    </div>
  )
}
