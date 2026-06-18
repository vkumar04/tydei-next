import { Skeleton } from "@/components/ui/skeleton"

/**
 * Vendor Renewals loading skeleton — mirrors
 * `components/vendor/renewals/vendor-renewals-client.tsx`: the inline
 * page header (h1 + description), the VendorRenewalsControlBar (status +
 * facility selects + search + export), the VendorRenewalsHero (label +
 * heading + status pill, then 4 border-y 30d/60d/90d/at-risk stats), the
 * Upcoming / In Progress / Healthy / Expired tab strip, and the renewal
 * pipeline cards. 2026-06-18: was 3 generic cards with no hero/tabs.
 */
export default function VendorRenewalsLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="space-y-1">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Control bar (status + facility selects + search + export) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
        <Skeleton className="h-9 w-40 rounded-md" />
        <Skeleton className="h-9 w-44 rounded-md" />
        <Skeleton className="h-9 min-w-[200px] flex-1 rounded-md" />
        <Skeleton className="ml-auto h-9 w-40 rounded-md" />
      </div>

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
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </section>

      {/* Tab strip (Upcoming / In Progress / Healthy / Expired) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Pipeline cards */}
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <Skeleton className="mt-4 h-2 w-full rounded-full" />
            <div className="mt-2 flex items-center justify-between">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
