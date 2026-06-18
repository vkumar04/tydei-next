import { Skeleton } from "@/components/ui/skeleton"

/**
 * Vendor market-share loading skeleton — mirrors
 * `components/vendor/market-share/market-share-client.tsx`: a PageHeader
 * (title + description on the left, a time-range Select on the right), the
 * MarketShareHero panel (eyebrow + headline + badge, then 4 border-y stats),
 * the Overview/By Category/By Facility/Competitors tab strip, and the
 * Overview content (a wide chart card).
 */
export default function VendorMarketShareLoading() {
  return (
    <div className="space-y-6">
      {/* PageHeader: title + description left, time-range dropdown right */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-[180px] rounded-md" />
      </div>

      {/* Hero panel */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-7 w-96 max-w-full" />
          </div>
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </section>

      {/* Tab strip (Overview / By Category / By Facility / Competitors) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Overview content: a wide chart card */}
      <div className="rounded-xl border bg-card p-6">
        <Skeleton className="mb-4 h-5 w-48" />
        <Skeleton className="h-[300px] w-full rounded" />
      </div>
    </div>
  )
}
