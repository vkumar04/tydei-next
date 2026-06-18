import { Skeleton } from "@/components/ui/skeleton"

/**
 * Vendor Prospective loading skeleton — mirrors
 * `app/vendor/prospective/prospective-client.tsx`: the ProspectiveHero
 * (label + heading + status badge, then 3 border-y proposal stats), the
 * Opportunities / My Proposals / Deal Scorer / Benchmarks / Analytics
 * tab strip, and the tab content (a 3-card grid). 2026-06-18: was a
 * form card + 3 result cards that didn't match the real layout.
 */
export default function VendorProspectiveLoading() {
  return (
    <div className="space-y-6">
      {/* Hero panel (3 stats) */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-7 w-80" />
          </div>
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </section>

      {/* Tab strip (Opportunities / My Proposals / Deal Scorer / Benchmarks / Analytics) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Tab content: a grid of opportunity / proposal cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-4 h-8 w-32" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-3/4" />
            <Skeleton className="mt-4 h-9 w-full rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
