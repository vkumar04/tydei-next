import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

/**
 * Purchase Orders loading skeleton — mirrors the real layout in
 * `components/facility/purchase-orders/po-list.tsx`: the POHero panel
 * (eyebrow + headline + status pill, then 4 border-y KPIs: Total POs /
 * On-Contract Spend / Off-Contract Spend / Pending Approval), the control
 * bar (search + status/vendor filters + Export/Create), the 4-tab strip
 * (All / On Contract / Off Contract / Pending), and the PO table card.
 * 2026-06-18: was a generic table card.
 */
export default function PurchaseOrdersLoading() {
  return (
    <div className="space-y-6">
      {/* POHero panel */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-7 w-72" />
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

      {/* Control bar (search + status/vendor filters + Export/Create) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
        <Skeleton className="h-9 w-48 flex-1" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-40" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* Tab strip (4 tabs) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* PO table */}
      <Card className="p-6">
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
