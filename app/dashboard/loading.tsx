import { Skeleton } from "@/components/ui/skeleton"

/**
 * Facility dashboard loading skeleton — mirrors the real layout in
 * `components/facility/dashboard/dashboard-client.tsx`: page header, the
 * single elevated hero panel (label + heading + badge, then 4 border-y
 * stats), the Overview/Spend/Alerts tab bar, and the Overview content grid
 * (2/3 spend-trend chart + 1/3 lifecycle pie). 2026-06-18: was a generic
 * 4-KPI-cards + 2×2 chart grid that didn't match the screen.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Hero panel */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-7 w-64" />
          </div>
          <Skeleton className="h-7 w-36 rounded-full" />
        </div>
        <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-3 w-36" />
            </div>
          ))}
        </div>
      </section>

      {/* Tab bar (Overview / Spend / Alerts) */}
      <div className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-16 rounded-md" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>

      {/* Overview content: 2/3 spend-trend chart + 1/3 lifecycle pie */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-6 lg:col-span-2">
          <Skeleton className="mb-4 h-5 w-40" />
          <Skeleton className="h-[300px] w-full rounded" />
        </div>
        <div className="rounded-xl border bg-card p-6">
          <Skeleton className="mb-4 h-5 w-32" />
          <div className="flex h-[300px] items-center justify-center">
            <Skeleton className="size-44 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
