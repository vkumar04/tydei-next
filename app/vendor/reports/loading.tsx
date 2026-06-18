import { Skeleton } from "@/components/ui/skeleton"

/**
 * Vendor Reports loading skeleton — mirrors
 * `components/vendor/reports-client.tsx`: the VendorReportsHero (label +
 * heading + status pill, then 4 border-y stats), the
 * VendorReportsControlBar (facility filter + search + New Report), the
 * "Contract Performance Details" section header + hub tab strip, the
 * ReportTypeGrid (4 report-type cards), and the RecentReportsTable.
 * 2026-06-18: was a single table card that didn't match.
 */
export default function VendorReportsLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Hero panel (4 stats) */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-80" />
          </div>
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </section>

      {/* Control bar (facility filter + search + New Report) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
        <Skeleton className="h-9 w-44 rounded-md" />
        <Skeleton className="h-9 min-w-[200px] flex-1 rounded-md" />
        <Skeleton className="ml-auto h-9 w-32 rounded-md" />
      </div>

      {/* Contract Performance Details section */}
      <section className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-96" />
        </div>
        {/* Hub tab strip */}
        <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </section>

      {/* Report-type grid (4 cards) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-6">
            <div className="flex items-start justify-between">
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-4 h-5 w-32" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-1 h-3 w-3/4" />
            <Skeleton className="mt-4 h-9 w-full rounded-md" />
          </div>
        ))}
      </div>

      {/* Recent reports table card */}
      <div className="rounded-xl border bg-card p-6">
        <Skeleton className="mb-4 h-5 w-40" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
