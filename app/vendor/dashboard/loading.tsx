import { Skeleton } from "@/components/ui/skeleton"

/**
 * Vendor dashboard loading skeleton — mirrors
 * `components/vendor/dashboard/vendor-dashboard-client.tsx`: page header,
 * the elevated VendorDashboardHero panel (eyebrow + headline + badge, then
 * 4 border-y stats), the Overview/Performance/Contracts tab bar, and the
 * Overview content (2-col grid of ~380px chart cards).
 */
export default function VendorDashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Hero panel */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-7 w-80" />
          </div>
          <Skeleton className="h-7 w-36 rounded-full" />
        </div>
        <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-3 w-36" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-4 h-3 w-72" />
      </section>

      {/* Tab bar (Overview / Performance / Contracts) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>

      {/* Overview content: 2-col chart grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-6">
            <Skeleton className="mb-4 h-5 w-40" />
            <Skeleton className="h-[300px] w-full rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
