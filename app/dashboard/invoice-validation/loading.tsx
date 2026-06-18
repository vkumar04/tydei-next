import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

/**
 * Invoice Validation loading skeleton — mirrors the real layout in
 * `components/facility/invoices/invoice-validation-client.tsx`: the
 * elevated hero panel (eyebrow + headline + status pill, then 4 border-y
 * KPIs: Total Invoices / Awaiting Review / Flagged Variance / Recovered),
 * the control bar (search + vendor/dispute filters + Upload/Export), the
 * 5-tab strip (Awaiting Review / Flagged Variances / Approved / Disputed /
 * All), and the discrepancy table. 2026-06-18: was a generic table card.
 */
export default function InvoiceValidationLoading() {
  return (
    <div className="space-y-6">
      {/* Hero panel */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-7 w-80" />
          </div>
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </section>

      {/* Control bar (search + vendor/dispute filters + Upload/Export) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
        <Skeleton className="h-9 w-48 flex-1" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-36" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </div>

      {/* Tab strip (5 tabs) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-8 w-36 rounded-md" />
        <Skeleton className="h-8 w-36 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>

      {/* Discrepancy table */}
      <Card className="p-4">
        <Skeleton className="mb-4 h-10 w-full" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </Card>
    </div>
  )
}
