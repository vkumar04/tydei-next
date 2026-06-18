import { Skeleton } from "@/components/ui/skeleton"

/**
 * Vendor alerts loading skeleton — mirrors
 * `components/vendor/alerts/vendor-alerts-client.tsx`: the elevated hero
 * panel (eyebrow + headline + badge, then 4 border-y stats), the
 * All/Active/Resolved tab strip (each with a count badge), the paginated
 * AlertsList rows, and the Previous/Next pagination row.
 */
export default function VendorAlertsLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Hero panel */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </section>

      {/* Tab strip (All / Active / Resolved, each with a count badge) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Alerts list rows */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-xl border bg-card p-4"
          >
            <div className="flex items-center gap-4">
              <Skeleton className="size-4 rounded" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-72" />
              </div>
            </div>
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        ))}
      </div>

      {/* Pagination row */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </div>
    </div>
  )
}
