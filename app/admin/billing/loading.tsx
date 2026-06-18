import { Skeleton } from "@/components/ui/skeleton"

/**
 * Admin billing loading skeleton — mirrors `app/admin/billing/page.tsx` +
 * `components/admin/billing-client.tsx`: page header (back button + title +
 * subtitle), a 4-card BillingOverview stats grid (md:grid-cols-4), the MRR card
 * with a 3-col text-stat block (NOT a chart), and the "Recent Invoices" card
 * wrapping a table. 2026-06-18: was 2 cards + a 300px chart that didn't match.
 */
export default function AdminBillingLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="size-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {/* BillingOverview stats */}
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* MRR card — 3 text stat blocks */}
      <div className="rounded-xl border bg-card p-6">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="mt-1 h-4 w-44" />
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-28" />
            </div>
          ))}
        </div>
      </div>

      {/* Recent Invoices card + table */}
      <div className="rounded-xl border bg-card">
        <div className="space-y-2 p-6">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="space-y-3 px-6 pb-6">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
