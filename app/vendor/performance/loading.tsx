import { Skeleton } from "@/components/ui/skeleton"

/**
 * Vendor Performance loading skeleton — mirrors
 * `components/vendor/performance/performance-client.tsx`: the elevated
 * PerformanceHero (label + heading + status pill, then 4 border-y stats),
 * the PerformanceControlBar row, the Overview/By Contract/Rebate
 * Progress/By Category tab strip, and the Overview content (a 2-up grid
 * of the monthly-trend + radar scorecard cards). 2026-06-18: was a
 * generic 4-KPI-cards grid + a single chart card that didn't match.
 */
export default function VendorPerformanceLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Hero panel (4 stats) */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-7 w-72" />
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
      </section>

      {/* Control bar (range select + counts + export) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
        <Skeleton className="h-9 w-48 rounded-md" />
        <Skeleton className="h-9 w-16 rounded-md" />
        <Skeleton className="h-9 w-16 rounded-md" />
        <Skeleton className="ml-auto h-9 w-32 rounded-md" />
      </div>

      {/* Tab strip (Overview / By Contract / Rebate Progress / By Category) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Overview content: monthly-trend chart + radar scorecard */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-6">
            <Skeleton className="mb-2 h-5 w-40" />
            <Skeleton className="mb-4 h-3 w-56" />
            <Skeleton className="h-[280px] w-full rounded" />
          </div>
        ))}
      </div>

      {/* Wide secondary chart card (monthly rebates earned) */}
      <div className="rounded-xl border bg-card p-6">
        <Skeleton className="mb-2 h-5 w-44" />
        <Skeleton className="mb-4 h-3 w-64" />
        <Skeleton className="h-[200px] w-full rounded" />
      </div>
    </div>
  )
}
