import { Skeleton } from "@/components/ui/skeleton"

/**
 * Reports Hub loading skeleton — mirrors the real layout in
 * `components/facility/reports/reports-client.tsx`: the `space-y-6` shell,
 * the `ReportsHero` panel (eyebrow + headline + status badge, then 4
 * `border-y py-6` stats: Contracts / Vendors / Active Schedules / Last
 * Sent), the flat `ReportsControlBar` filter row (date range + vendor +
 * contract selects + Schedules CTA), the dynamic tab strip (Overview /
 * per-type / By Rebate Type / Calculations), and the Overview content
 * (a wide chart card + a table card). Kept consistent with the page's
 * inline `ReportsHubSkeleton` Suspense fallback but faithful to the real
 * structure. 2026-06-18: was a generic 5-tab + 2-card layout.
 */
export default function ReportsLoading() {
  return (
    <div className="space-y-6">
      {/* ── Hero panel ────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-7 w-80 max-w-full" />
          </div>
          <Skeleton className="h-6 w-36 rounded-full" />
        </div>

        <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
      </section>

      {/* ── Control bar (filters) ─────────────────────────────── */}
      <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-64 rounded-md" />
          <Skeleton className="h-9 w-[200px] rounded-md" />
          <Skeleton className="h-9 w-[240px] rounded-md" />
          <Skeleton className="ml-auto h-9 w-28 rounded-md" />
        </div>
      </section>

      {/* ── Tab strip (dynamic: Overview / per-type / Calculations) ── */}
      <div className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>

      {/* ── Content: wide chart card + table card ─────────────── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <Skeleton className="mb-4 h-5 w-48" />
        <Skeleton className="h-[300px] w-full rounded" />
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <Skeleton className="mb-4 h-5 w-40" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
